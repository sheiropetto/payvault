import { authenticate } from '../../utils/auth';

/**
 * READ-ONLY DeepSeek test endpoint.
 * Extracts transactions from a bank statement using DeepSeek API,
 * returns the parsed JSON WITHOUT writing to the database.
 * Use this to compare DeepSeek vs Gemini output side-by-side.
 *
 * POST /api/deepseek/test-deepseek
 * Body: { statement_id: string }
 * Requires: DEEPSEEK_API_KEY secret set via `wrangler pages secret put DEEPSEEK_API_KEY`
 */

export async function onRequest(context) {
  const { request, env } = context;
  const startTime = Date.now();

  try {
    const user = await authenticate(request, env, 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const { statement_id, text } = await request.json();
    if (!statement_id) {
      return Response.json({ error: 'statement_id required' }, { status: 400 });
    }

    // Check DEEPSEEK_API_KEY exists
    if (!env.DEEPSEEK_API_KEY) {
      return Response.json({ error: 'DEEPSEEK_API_KEY not configured. Run: wrangler pages secret put DEEPSEEK_API_KEY' }, { status: 500 });
    }

    // Get statement info
    const stmt = await env.DB.prepare(
      'SELECT * FROM bank_statements WHERE id = ?'
    ).bind(statement_id).first();

    if (!stmt) {
      return Response.json({ error: 'Statement not found' }, { status: 404 });
    }

    let pdfText = text;

    // Load PDF text from storage if no text provided
    if (!pdfText) {
      const fileObj = await env.STORAGE.get(stmt.file_url);
      if (!fileObj) {
        return Response.json({ error: 'File not found in storage' }, { status: 404 });
      }

      const fileBuffer = await fileObj.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);

      function extractTextFromPDF(bytes) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let raw = decoder.decode(bytes);
        const textParts = [];
        const btMatches = raw.match(/\(([^)]*)\)/g) || [];
        for (const m of btMatches) {
          const cleaned = m.slice(1, -1)
            .replace(/\\([0-9]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
            .replace(/\\(.)/g, '$1')
            .replace(/%20/g, ' ')
            .trim();
          if (cleaned.length > 1) textParts.push(cleaned);
        }
        return textParts.join('\n');
      }

      pdfText = extractTextFromPDF(fileBytes);

      // If raw PDF extraction yielded nothing useful, try reading as plain text
      if (!pdfText || pdfText.length < 50) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        pdfText = decoder.decode(fileBytes);
        // Strip non-printable junk
        pdfText = pdfText.replace(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g, ' ').replace(/\s{3,}/g, '\n');
      }
    }

    const systemPrompt = `Act as an expert data extraction engine specializing in financial documents. You are parsing text from Malaysian bank statements into structured JSON.

Analyze the statement text. Pay extreme attention to the specific patterns of Malaysian banking data:
1. Date Context: Dates are listed as "DD/MM" (e.g., 03/01, 04/01). Infer the correct year based on the statement header (e.g. 2023).
2. Multi-line Transactions: A single transaction description often spans multiple lines before the next numerical amount aligns with it. Group and combine them logically.
3. Local Transaction Type Identifiers: Capture structural terms unique to Malaysia, such as "DUITNOW TRSF DR", "DUITNOW TRSF CR", "GIRO PYMT", "FPX", "TSFR FUND DR-ATM/EFT", and statutory payments like "KUMPULAN WANG SIMPANAN PEKERJA" (EPF) or "PERTUBUHAN KESELAMATAN SOSIAL" (SOCSO).
4. Number Formatting: Standardize numbers by removing commas.

To ensure exact chronological order of extraction, follow these strict rules:
- Sequential Index: Add an incrementing integer "idx" starting from 1 for every single transaction extracted. Extract row-by-row top-to-bottom as printed. Do not sort by date during extraction.
- Mathematical Balance Validation: Follow the flow of the "BALANCE" column. If the balance decreases, it must match the DEBIT amount. If it increases, it must match the CREDIT amount. Use this rolling balance to verify you haven't skipped lines or swapped the order of intra-day rows.

Return a JSON array of objects. Each object MUST have exactly these fields:
- "idx": Sequential incrementing integer starting from 1.
- "date": transaction date in YYYY-MM-DD format. Infer the year from the statement header.
- "description": The full combined multi-line transaction details. Keep it clean and readable, but preserve the core payee name, type, and crucial info (maximum 100 characters).
- "debit_amount": amount DEBITED (money going OUT). Number, 0 if this is a credit. Never negative.
- "credit_amount": amount CREDITED (money coming IN). Number, 0 if this is a debit. Never negative.
- "balance": the running balance AFTER this transaction (number). null if not available.
- "category": classify as one of: "Payment", "Credit/Deposit", "Fund Transfer", "Bank Fee", "Interest", "Other"
  - "Payment" = money going out for bills, loans, purchases, or merchant payments
  - "Credit/Deposit" = money coming in (salary, refund, cash deposit, etc.)
  - "Fund Transfer" = transfers between accounts (DUITNOW, IBG, GIRO transfers, bank transfers)
  - "Bank Fee" = bank charges, service fees, ATM fees
  - "Interest" = interest earned or charged
  - "Other" = anything else
- "payee": Extract the recipient/payee name from the description. Strip away transaction codes (TSFR FUND, GIRO PYMT, DUITNOW TRSF, DR-ECP, LOAN PYMT, etc.) and reference numbers. Keep ONLY the actual person or company name. Return empty string "" if no clear payee is identifiable (e.g. loan account numbers, internal transfers).

CRITICAL RULES:
1. Extract EVERY transaction row — do not summarize or skip
2. If a row has a date and a description, it's a transaction
3. Opening/closing balances are NOT transactions — skip them
4. Return ONLY valid JSON array — no markdown, no explanations, no code blocks`;

    // ============================================================
    // DeepSeek API call (OpenAI-compatible chat completions)
    // Text-only — no multimodal/vision support
    // ============================================================
    const deepseekUrl = 'https://api.deepseek.com/v1/chat/completions';

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Extract ALL transactions from this bank statement. Return ONLY a JSON array.\n\nRaw text:\n\n${pdfText.slice(0, 80000)}`
      }
    ];

    const aiStartTime = Date.now();
    const response = await fetch(deepseekUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.0,
        max_tokens: 16384,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(120000),
    });
    const aiDuration = Date.now() - aiStartTime;

    if (!response.ok) {
      const errText = await response.text();
      return Response.json({
        error: `DeepSeek API error (${response.status})`,
        details: errText.slice(0, 1000),
        provider: 'deepseek',
        duration_ms: Date.now() - startTime
      }, { status: 502 });
    }

    const aiResult = await response.json();
    const usage = aiResult.usage || {};
    const content = aiResult.choices?.[0]?.message?.content;
    const finishReason = aiResult.choices?.[0]?.finish_reason;

    if (!content) {
      return Response.json({
        error: 'DeepSeek returned empty response',
        raw_response: JSON.stringify(aiResult).slice(0, 2000),
        provider: 'deepseek',
        duration_ms: Date.now() - startTime
      }, { status: 502 });
    }

    // ============================================================
    // Parse the response — same logic as Gemini extract
    // ============================================================
    let transactions = null;
    let parseMethod = 'direct';

    try {
      // DeepSeek with json_object mode wraps array in an object
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        transactions = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const arrayField = Object.values(parsed).find(val => Array.isArray(val));
        transactions = arrayField || [parsed];
        parseMethod = arrayField ? 'wrapped_object' : 'single_object';
      }
    } catch (e) {
      parseMethod = 'fallback_regex';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          transactions = JSON.parse(jsonMatch[0]);
          parseMethod = 'bracket_extract';
        } catch (err) {
          const objMatch = content.match(/\{[\s\S]*\}/);
          if (objMatch) {
            try {
              const parsedObj = JSON.parse(objMatch[0]);
              const arrayField = Object.values(parsedObj).find(val => Array.isArray(val));
              transactions = arrayField || [parsedObj];
              parseMethod = 'object_bracket_extract';
            } catch (innerErr) {
              // give up
            }
          }
        }
      }
    }

    if (!transactions || !Array.isArray(transactions)) {
      return Response.json({
        error: 'Could not parse DeepSeek response as an array of transactions',
        finish_reason: finishReason,
        raw_output_truncated: content.slice(0, 3000),
        content_length: content.length,
        provider: 'deepseek',
        duration_ms: Date.now() - startTime
      }, { status: 500 });
    }

    // Sort by idx
    transactions.sort((a, b) => (a.idx || 0) - (b.idx || 0));

    const totalDuration = Date.now() - startTime;

    // ============================================================
    // Return results — NO DATABASE WRITES
    // ============================================================
    return Response.json({
      success: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      statement_id,
      statement_filename: stmt.original_filename || stmt.file_url,
      file_type: stmt.file_type,

      // The extracted transactions (read-only, not saved)
      transactions,
      total_extracted: transactions.length,

      // Timing & cost info
      timing: {
        total_ms: totalDuration,
        ai_call_ms: aiDuration,
        text_extraction_ms: totalDuration - aiDuration
      },
      usage: {
        prompt_tokens: usage.prompt_tokens || null,
        completion_tokens: usage.completion_tokens || null,
        total_tokens: usage.total_tokens || null,
        // DeepSeek pricing (approx): $0.27/1M input, $1.10/1M output
        estimated_cost_usd: usage.prompt_tokens != null
          ? ((usage.prompt_tokens / 1_000_000) * 0.27 + (usage.completion_tokens / 1_000_000) * 1.10).toFixed(6)
          : null
      },
      parse_method: parseMethod,
      finish_reason: finishReason,

      // Text sent to AI (for debugging)
      text_preview: pdfText.slice(0, 500),

      // Compare hint
      compare_hint: 'Compare this output with Gemini by calling /api/deepseek/extract with the same statement_id. Check: total_extracted count, description accuracy, category correctness, payee extraction.'
    });

  } catch (err) {
    return Response.json({
      error: err.message,
      provider: 'deepseek',
      duration_ms: Date.now() - startTime
    }, { status: 500 });
  }
}
