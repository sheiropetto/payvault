import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;

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

    // Get statement info
    const stmt = await env.DB.prepare(
      'SELECT * FROM bank_statements WHERE id = ?'
    ).bind(statement_id).first();

    if (!stmt) {
      return Response.json({ error: 'Statement not found' }, { status: 404 });
    }

    // Update status to processing
    await env.DB.prepare(
      "UPDATE bank_statements SET status = 'processing' WHERE id = ?"
    ).bind(statement_id).run();

    let pdfText = text;
    let pdfBase64 = null;

    // Load PDF from storage if statement is PDF
    if (stmt.file_type === 'pdf') {
      try {
        const fileObj = await env.STORAGE.get(stmt.file_url);
        if (fileObj) {
          const fileBuffer = await fileObj.arrayBuffer();
          // Safe base64 conversion
          let binary = '';
          const bytes = new Uint8Array(fileBuffer);
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          pdfBase64 = btoa(binary);
        }
      } catch (err) {
        console.error('Failed to load PDF from storage for multimodal extraction:', err);
      }
    }

    // If it's not a PDF or we failed to get it, and we don't have text, use fallback extraction
    if (!pdfText && !pdfBase64) {
      const fileObj = await env.STORAGE.get(stmt.file_url);
      if (!fileObj) {
        await env.DB.prepare(
          "UPDATE bank_statements SET status = 'error' WHERE id = ?"
        ).bind(statement_id).run();
        return Response.json({ error: 'File not found in storage' }, { status: 404 });
      }

      const fileBuffer = await fileObj.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);

      // Extract text from PDF/CSV by decoding common PDF text patterns
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
    }

    // Call DeepSeek API with text content or base64 PDF
    const systemPrompt = `Act as an expert data extraction engine specializing in financial documents. You are parsing text or visual layout from Malaysian bank statements into structured JSON.

Analyze the statement. Pay extreme attention to the specific patterns of Malaysian banking data:
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
- "payee": Extract the recipient/payee name from the description. Strip away transaction codes (TSFR FUND, GIRO PYMT, DUITNOW TRSF, DR-ECP, LOAN PYMT, etc.) and reference numbers. Keep ONLY the actual person or company name. Return empty string "" if no clear payee is identifiable (e.g. loan account numbers, internal transfers). Examples:
  - "TSFR FUND DR-ATM/EFT 038556 MAHIRIBU SDN BHD" → "MAHIRIBU SDN BHD"
  - "DUITNOW TRSF DR 140772 FARZIEYANA BINTI MOH" → "FARZIEYANA BINTI MOH"
  - "DR-ECP 772889 KUMPULAN WANG SIMPANAN PEKERJA" → "KUMPULAN WANG SIMPANAN PEKERJA"
  - "AUTOMATED LOAN PYMT TO 8025946828 AT H25" → ""
  - "GIRO PYMT-ATM/EFT 846824 LHDN" → "LHDN"

CRITICAL RULES:
1. Extract EVERY transaction row — do not summarize or skip
2. If a row has a date and a description, it's a transaction
3. Opening/closing balances are NOT transactions — skip them
4. Return ONLY valid JSON array — no markdown, no explanations, no code blocks`;

    const model = 'gemini-3.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    let contentsParts = [];
    if (pdfBase64) {
      contentsParts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64
        }
      });
      contentsParts.push({
        text: systemPrompt + '\n\nExtract ALL transactions from this bank statement. Return ONLY a JSON array.'
      });
    } else {
      contentsParts.push({
        text: systemPrompt + '\n\n' + `Extract ALL transactions from this bank statement. Return ONLY a JSON array.\n\nRaw text:\n\n${pdfText.slice(0, 80000)}`
      });
    }

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: contentsParts,
        }],
        generationConfig: {
          temperature: 0.05,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                idx: { type: 'INTEGER', description: 'Sequential index starting from 1' },
                date: { type: 'STRING', description: 'Transaction date in YYYY-MM-DD format' },
                description: { type: 'STRING', description: 'Cleaned transaction description or payee name (max 50 chars)' },
                debit_amount: { type: 'NUMBER', description: 'Amount debited (outgoing money), 0 if credit' },
                credit_amount: { type: 'NUMBER', description: 'Amount credited (incoming money), 0 if debit' },
                balance: { type: 'NUMBER', description: 'Running balance after the transaction, null if not available' },
                category: {
                  type: 'STRING',
                  enum: ['Payment', 'Credit/Deposit', 'Fund Transfer', 'Bank Fee', 'Interest', 'Other'],
                  description: 'Category classification'
                },
                payee: {
                  type: 'STRING',
                  description: 'Extracted payee/recipient name from description, empty string if none'
                }
              },
              required: ['idx', 'date', 'description', 'debit_amount', 'credit_amount', 'category', 'payee']
            }
          }
        },
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      await env.DB.prepare(
        "UPDATE bank_statements SET status = 'error' WHERE id = ?"
      ).bind(statement_id).run();
      return Response.json({ error: `Gemini API error: ${errText}` }, { status: 502 });
    }

    const aiResult = await response.json();
    const candidate = aiResult.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const content = candidate?.content?.parts?.[0]?.text;

    if (!content) {
      console.error('Gemini API returned empty response:', JSON.stringify(aiResult));
      throw new Error(`Empty response from Gemini API: ${JSON.stringify(aiResult.promptFeedback || aiResult)}`);
    }

    let transactions = null;
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        transactions = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const arrayField = Object.values(parsed).find(val => Array.isArray(val));
        transactions = arrayField || [parsed];
      }
    } catch (e) {
      console.warn('Failed standard JSON parse, attempting fallback regex parser:', e.message);
      // Try to extract JSON from markdown/bracket matches
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          transactions = JSON.parse(jsonMatch[0]);
        } catch (err) {
          const objMatch = content.match(/\{[\s\S]*\}/);
          if (objMatch) {
            try {
              const parsedObj = JSON.parse(objMatch[0]);
              const arrayField = Object.values(parsedObj).find(val => Array.isArray(val));
              transactions = arrayField || [parsedObj];
            } catch (innerErr) {
              console.error('Failed to parse matched object block:', innerErr.message);
            }
          }
        }
      }
    }

    if (!transactions || !Array.isArray(transactions)) {
      console.error("Gemini Raw Output:", content);
      throw new Error(`Could not parse AI response as an array of transactions. Reason: ${finishReason}, Length: ${content.length}, End of Content: ${content.slice(-200)}`);
    }

    // Sort transactions by sequential index to guarantee exact printed order
    transactions.sort((a, b) => (a.idx || 0) - (b.idx || 0));

    // Insert transactions into DB
    const insertStmt = env.DB.prepare(
      `INSERT INTO transactions (bank_statement_id, date, description, debit_amount, credit_amount, balance, category, payee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let insertedCount = 0;
    for (const tx of transactions) {
      try {
        await insertStmt.bind(
          statement_id,
          tx.date,
          tx.description,
          tx.debit_amount || 0,
          tx.credit_amount || 0,
          tx.balance ?? null,
          tx.category || 'Other',
          tx.payee || ''
        ).run();
        insertedCount++;
      } catch (e) {
        // Skip malformed rows
        console.error('Skipping transaction:', e.message);
      }
    }

    // Update statement status to done
    await env.DB.prepare(
      "UPDATE bank_statements SET status = 'done' WHERE id = ?"
    ).bind(statement_id).run();

    return Response.json({
      success: true,
      total_extracted: transactions.length,
      total_inserted: insertedCount,
      message: `Successfully extracted ${insertedCount} transactions`,
    });

  } catch (err) {
    // Mark statement as error
    try {
      const { statement_id } = await request.json();
      if (statement_id) {
        await env.DB.prepare(
          "UPDATE bank_statements SET status = 'error' WHERE id = ?"
        ).bind(statement_id).run();
      }
    } catch { }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
