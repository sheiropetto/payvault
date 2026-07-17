import { authenticate } from '../../utils/auth';
import { toProperFilename } from '../bank-statements/index';

const SYSTEM_PROMPT = `Act as an expert data extraction engine specializing in financial documents. You are parsing text from Malaysian bank statements into structured JSON.

Analyze the statement text. Pay extreme attention to the specific patterns of Malaysian banking data:
1. Date Context: Dates are listed as "DD/MM" (e.g., 03/01, 04/01). Infer the correct year based on the statement header (e.g. 2023).
2. Multi-line Transactions: A single transaction description often spans multiple lines before the next numerical amount aligns with it. Group and combine them logically.
3. Local Transaction Type Identifiers:
   - "DR" or "TRSF DR" or "DUITNOW TRSF DR" = DEBIT (money going OUT). The amount belongs to THIS transaction.
   - "CR" or "CDT" or "TRSF CR" or "DUITNOW TRSF CR" = CREDIT (money coming IN). The amount belongs to THIS transaction.
   - "DEP-CASH CDT" = Cash deposit (CREDIT). The amount is money coming IN.
   - "GIRO PYMT", "FPX", "TSFR FUND DR-ATM/EFT" = DEBIT (money going OUT).
   - "KUMPULAN WANG SIMPANAN PEKERJA" (EPF), "PERTUBUHAN KESELAMATAN SOSIAL" (SOCSO) = statutory payments.
4. Number Formatting: Standardize numbers by removing commas.

CRITICAL AMOUNT ASSIGNMENT RULE:
Each amount belongs to the transaction it is DIRECTLY aligned with or immediately follows. Never swap amounts between transactions. A DR transaction gets its own amount as debit_amount, a CR/CDT transaction gets its own amount as credit_amount. If two transactions appear adjacent with different amounts, each keeps its own amount — do NOT mix them up.

Example of correct extraction:
Text:
  11/05 DEP-CASH CDT 1687 0273            5,000.00
  11/05 DUITNOW TRSF DR 28223 DANION   100,000.00

Correct output:
  [
    {"idx":1,"date":"2023-05-11","description":"DEP-CASH CDT 1687 0273","debit_amount":0,"credit_amount":5000.00,"category":"Credit/Deposit","payee":""},
    {"idx":2,"date":"2023-05-11","description":"DUITNOW TRSF DR 28223 DANION","debit_amount":100000.00,"credit_amount":0,"category":"Fund Transfer","payee":"DANION A/L LEWIS"}
  ]

To ensure exact chronological order of extraction, follow these strict rules:
- Sequential Index: Add an incrementing integer "idx" starting from 1 for every single transaction extracted. Extract row-by-row top-to-bottom as printed. Do not sort by date during extraction.

Return a JSON array of objects. Each object MUST have exactly these fields:
- "idx": Sequential incrementing integer starting from 1.
- "date": transaction date in YYYY-MM-DD format. Infer the year from the statement header.
- "description": The full combined multi-line transaction details. Keep it clean and readable, but preserve the core payee name, type, and crucial info (maximum 100 characters).
- "debit_amount": amount DEBITED (money going OUT). Number, 0 if this is a credit. Never negative.
- "credit_amount": amount CREDITED (money coming IN). Number, 0 if this is a debit. Never negative.
- "category": classify as one of: "Payment", "Credit/Deposit", "Fund Transfer", "Bank Fee", "Interest", "Other"
- "payee": Extract the recipient/payee name from the description. Strip away transaction codes and reference numbers. Keep ONLY the actual person or company name. Return empty string "" if no clear payee is identifiable.

CRITICAL RULES:
1. Extract EVERY transaction row — do not summarize or skip
2. If a row has a date and a description, it's a transaction
3. Opening/closing balances are NOT transactions — skip them
4. Each amount stays with its OWN transaction — never swap amounts between rows
5. Return ONLY valid JSON array — no markdown, no explanations, no code blocks`;

// ─── Post-extraction validator: cross-check DR/CR/CDT against amounts ───
function validateAndCorrect(transactions, rawText) {
  const corrections = [];
  // Normalize raw text for amount extraction
  const lines = rawText.split('\n');

  for (const tx of transactions) {
    const desc = (tx.description || '').toUpperCase();

    // Detect transaction type from description keywords
    const isDebit = /\b(DR|TRSF\s*DR|DUITNOW\s+TRSF\s+DR|GIRO\s+PYMT|FPX|TSFR\s+FUND\s+DR)\b/.test(desc);
    const isCredit = /\b(CR|CDT|TRSF\s*CR|DUITNOW\s+TRSF\s+CR|DEP[- ]?CASH)\b/.test(desc);

    if (!isDebit && !isCredit) continue; // can't determine type, skip

    const hasDebitAmt = (tx.debit_amount || 0) > 0;
    const hasCreditAmt = (tx.credit_amount || 0) > 0;

    // Correct case: DR → debit, CR/CDT → credit
    if (isDebit && hasDebitAmt && !hasCreditAmt) continue;
    if (isCredit && hasCreditAmt && !hasDebitAmt) continue;

    // Mismatch detected — try to find the correct amount from raw text
    let corrected = false;
    const totalAmount = (tx.debit_amount || 0) + (tx.credit_amount || 0);

    if (totalAmount > 0) {
      if (isDebit) {
        tx.debit_amount = totalAmount;
        tx.credit_amount = 0;
        if (tx.category === 'Credit/Deposit') tx.category = guessCategory(desc);
        corrected = true;
        corrections.push({ idx: tx.idx, desc: tx.description, fixed: 'swapped to debit', amount: totalAmount });
      } else if (isCredit) {
        tx.credit_amount = totalAmount;
        tx.debit_amount = 0;
        if (tx.category !== 'Credit/Deposit') tx.category = 'Credit/Deposit';
        corrected = true;
        corrections.push({ idx: tx.idx, desc: tx.description, fixed: 'swapped to credit', amount: totalAmount });
      }
    }

    // If still wrong (no amount at all), try to find amount from raw text lines
    if (!corrected && tx.description) {
      for (const line of lines) {
        if (line.includes(tx.description.slice(0, 20))) {
          const amtMatch = line.match(/([\d,]+\.\d{2})\s*$/);
          if (amtMatch) {
            const rawAmt = parseFloat(amtMatch[1].replace(/,/g, ''));
            if (!isNaN(rawAmt) && rawAmt > 0) {
              if (isDebit) { tx.debit_amount = rawAmt; tx.credit_amount = 0; }
              else { tx.credit_amount = rawAmt; tx.debit_amount = 0; }
              corrections.push({ idx: tx.idx, desc: tx.description, fixed: 'from raw text', amount: rawAmt });
            }
          }
          break;
        }
      }
    }
  }

  return corrections;
}

function guessCategory(desc) {
  const d = desc.toUpperCase();
  if (/\b(DUITNOW|TRSF|GIRO|FPX|IBG|TRANSFER)\b/.test(d)) return 'Fund Transfer';
  if (/\b(FEE|CHARGE|COMMISSION)\b/.test(d)) return 'Bank Fee';
  if (/\b(INTEREST|DIVIDEND)\b/.test(d)) return 'Interest';
  if (/\b(EPF|SOCSO|KWSP|PERKESO|LHDN|HASIL|CUKAI)\b/.test(d)) return 'Payment';
  return 'Payment';
}

// ─── Parse AI response (works for both DeepSeek & Gemini) ───
function parseTransactions(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const arr = Object.values(parsed).find(val => Array.isArray(val));
      return arr || [parsed];
    }
  } catch (e) { /* fall through to regex */ }

  // Fallback: extract JSON from markdown/bracket matches
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]);
        const arr = Object.values(obj).find(val => Array.isArray(val));
        return arr || [obj];
      } catch {}
    }
  }
  return null;
}

// ─── Call DeepSeek API ───
async function callDeepSeek(apiKey, pdfText) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Extract ALL transactions from this bank statement. Return ONLY a JSON array.\n\nRaw text:\n\n${pdfText.slice(0, 80000)}` }
      ],
      temperature: 0.0,
      max_tokens: 16384,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned empty response');

  const transactions = parseTransactions(content);
  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    throw new Error('DeepSeek returned 0 transactions');
  }

  return { transactions, provider: 'deepseek', usage: data.usage };
}

// ─── Call Gemini API (fallback) ───
async function callGemini(apiKey, pdfText) {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: SYSTEM_PROMPT + '\n\n' + `Extract ALL transactions from this bank statement. Return ONLY a JSON array.\n\nRaw text:\n\n${pdfText.slice(0, 80000)}` }]
      }],
      generationConfig: { temperature: 0.05 }
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini returned empty response');

  const transactions = parseTransactions(content);
  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    throw new Error('Gemini returned 0 transactions');
  }

  return { transactions, provider: 'gemini', usage: data.usageMetadata };
}

// ─── Main handler ───
export async function onRequest(context) {
  const { request, env } = context;

  try {
    const user = await authenticate(request, env, 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const { statement_id, text, provider: preferredProvider } = await request.json();
    if (!statement_id) {
      return Response.json({ error: 'statement_id required' }, { status: 400 });
    }

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

    // If no text provided, try loading from storage
    if (!pdfText) {
      const fileObj = await env.STORAGE.get(stmt.file_url);
      if (!fileObj) {
        await env.DB.prepare("UPDATE bank_statements SET status = 'error' WHERE id = ?").bind(statement_id).run();
        return Response.json({ error: 'File not found in storage' }, { status: 404 });
      }

      const fileBuffer = await fileObj.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let raw = decoder.decode(fileBytes);
      const textParts = [];
      const btMatches = raw.match(/\(([^)]*)\)/g) || [];
      for (const m of btMatches) {
        const cleaned = m.slice(1, -1).replace(/\\([0-9]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))).replace(/\\(.)/g, '$1').replace(/%20/g, ' ').trim();
        if (cleaned.length > 1) textParts.push(cleaned);
      }
      pdfText = textParts.join('\n');
      if (!pdfText || pdfText.length < 50) {
        pdfText = raw.replace(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g, ' ').replace(/\s{3,}/g, '\n');
      }
    }

    // ─── Use the user's chosen provider (no auto-fallback) ───
    let result;
    let provider = preferredProvider || 'deepseek';

    if (provider === 'gemini') {
      if (!env.GEMINI_API_KEY) {
        return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
      }
      result = await callGemini(env.GEMINI_API_KEY, pdfText);
    } else {
      if (!env.DEEPSEEK_API_KEY) {
        return Response.json({ error: 'DEEPSEEK_API_KEY not configured' }, { status: 500 });
      }
      result = await callDeepSeek(env.DEEPSEEK_API_KEY, pdfText);
    }

    const { transactions } = result;

    // Sort by idx
    transactions.sort((a, b) => (a.idx || 0) - (b.idx || 0));

    // ─── Post-extraction validation: cross-check DR/CR/CDT against raw text ───
    const corrections = validateAndCorrect(transactions, pdfText);

    // Insert into DB (no balance column)
    const insertStmt = env.DB.prepare(
      `INSERT INTO transactions (bank_statement_id, date, description, debit_amount, credit_amount, category, payee)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
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
          tx.category || 'Other',
          tx.payee || ''
        ).run();
        insertedCount++;
      } catch (e) {
        console.error('Skipping transaction:', e.message);
      }
    }

    // Update statement status, auto-detect year/month, and auto-rename filename
    const firstDate = transactions[0]?.date || '';
    const detectedYear = firstDate.slice(0, 4) || null;
    const detectedMonth = firstDate.slice(5, 7) || null;
    const properName = toProperFilename(stmt.filename, detectedMonth ? parseInt(detectedMonth) : null, detectedYear ? parseInt(detectedYear) : null, stmt.file_type);
    await env.DB.prepare(
      "UPDATE bank_statements SET status = 'done', year = ?, month = ?, filename = ? WHERE id = ?"
    ).bind(detectedYear, detectedMonth, properName, statement_id).run();

    return Response.json({
      success: true,
      provider,
      total_extracted: transactions.length,
      total_inserted: insertedCount,
      corrections: corrections.length,
      correction_details: corrections,
      message: corrections.length > 0
        ? `[${provider}] Extracted ${insertedCount} transactions · Auto-corrected ${corrections.length} amount(s)`
        : `[${provider}] Successfully extracted ${insertedCount} transactions`,
    });

  } catch (err) {
    try {
      const body = await request.clone().json().catch(() => ({}));
      if (body.statement_id) {
        await env.DB.prepare("UPDATE bank_statements SET status = 'error' WHERE id = ?").bind(body.statement_id).run();
      }
    } catch {}
    return Response.json({ error: err.message }, { status: 500 });
  }
}
