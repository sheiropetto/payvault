import { authenticate } from '../../utils/auth';
import { toProperFilename } from '../bank-statements/index';

const SYSTEM_PROMPT = `Act as an expert data extraction engine specializing in financial documents. You are parsing text from Malaysian bank statements into structured JSON.

Analyze the statement text. Pay extreme attention to these Malaysian banking patterns:

## MULTI-LINE TRANSACTION GROUPING (MOST IMPORTANT)

Bank statements group transactions per date. Under each date, there may be MULTIPLE transactions, each spanning 2-3 lines. Here is how to parse them:

1. A line starting with "DD/MM" (e.g., "02/05") marks the START of a new date group. The date applies to ALL transactions that follow until the next date line.

2. Within a date group, identify transaction boundaries using these signals:
   - Lines containing a TRANSACTION CODE start a NEW transaction. Transaction codes include:
     "TSFR FUND CR", "TSFR FUND DR", "DUITNOW TRSF DR", "DUITNOW TRSF CR",
     "GIRO PYMT", "FPX", "DEP-CASH CDT", "IBG TRSF", "ATM CASH",
     "CHEQUE PROCESS FEE", "LEMBAGA HASIL DALAM NEGERI"
   - Lines WITHOUT a transaction code (e.g., account numbers like "3149XXXXX", names like "MAHIRIBU SDN BHD", remarks like "BUDGET" or "PAYMENT") are CONTINUATION lines of the preceding transaction.

3. The amount (e.g., "5,000.00", "30,000.00") at the END of a line belongs to THAT line's transaction.
   - If the line has a transaction code containing "CR" or "CDT" → it's a credit_amount
   - If the line has a transaction code containing "DR" → it's a debit_amount
   - The amount on a continuation line (no transaction code) is NOT a separate transaction — it's additional info.

## EXAMPLE OF CORRECT MULTI-LINE EXTRACTION

Raw text:
  02/05 TSFR FUND CR-ATM/EFT 631597          5,000.00
        3149XXXXX MAHIRIBU SDN BHD BUDGET
        TSFR FUND CR-ATM/EFT 631639         10,000.00
        3149XXXXX MAHIRIBU SDN BHD PAYMENT
        DUITNOW TRSF DR 674679 TAN KHENG   30,000.00
  05/05 TSFR FUND CR-ATM/EFT 388594         12,000.00
        3149XXXXX MAHIRIBU SDN BHD MARGIN
        DUITNOW TRSF DR 410085              2,500.00

Correct output:
  [
    {"idx":1,"date":"2023-05-02","description":"TSFR FUND CR-ATM/EFT 631597 3149XXXXX MAHIRIBU SDN BHD BUDGET","debit_amount":0,"credit_amount":5000.00,"category":"Credit/Deposit","payee":"MAHIRIBU SDN BHD"},
    {"idx":2,"date":"2023-05-02","description":"TSFR FUND CR-ATM/EFT 631639 3149XXXXX MAHIRIBU SDN BHD PAYMENT","debit_amount":0,"credit_amount":10000.00,"category":"Credit/Deposit","payee":"MAHIRIBU SDN BHD"},
    {"idx":3,"date":"2023-05-02","description":"DUITNOW TRSF DR 674679 TAN KHENG KOOI PAYMENT","debit_amount":30000.00,"credit_amount":0,"category":"Fund Transfer","payee":"TAN KHENG KOOI"},
    {"idx":4,"date":"2023-05-05","description":"TSFR FUND CR-ATM/EFT 388594 3149XXXXX MAHIRIBU SDN BHD MARGIN","debit_amount":0,"credit_amount":12000.00,"category":"Credit/Deposit","payee":"MAHIRIBU SDN BHD"},
    {"idx":5,"date":"2023-05-05","description":"DUITNOW TRSF DR 410085","debit_amount":2500.00,"credit_amount":0,"category":"Fund Transfer","payee":""}
  ]

## TRANSACTION TYPE IDENTIFIERS
- "TSFR FUND CR" (including "TSFR FUND CR-ATM/EFT") or "DUITNOW TRSF CR" = CREDIT (money IN) → credit_amount
- "TSFR FUND DR" or "DUITNOW TRSF DR" or "GIRO PYMT" or "FPX" = DEBIT (money OUT) → debit_amount
- "DEP-CASH CDT" = Cash deposit CREDIT → credit_amount
- "CHEQUE PROCESS FEE" = Bank fee DEBIT → debit_amount, category: "Bank Fee"
- "KUMPULAN WANG SIMPANAN PEKERJA" (EPF), "PERTUBUHAN KESELAMATAN SOSIAL" (SOCSO), "LEMBAGA HASIL DALAM NEGERI" (LHDN) = statutory payments → debit_amount
- "IBG TRSF" without CR/DR → check context: if amount is in debit column → debit; if credit column → credit

## NUMBER FORMATTING
Standardize numbers by removing commas. Date format: YYYY-MM-DD (infer year from statement header, e.g., "Statement Date 31 May 2023" → year is 2023).

## AMOUNT RULE
Each amount belongs to the transaction it is DIRECTLY on the same line with. Never swap amounts between transactions. Never duplicate amounts.

## SKIP THESE — THEY ARE NOT TRANSACTIONS
- "Balance From Last Statement", "Balance B/F", "Balance C/F", "Closing Balance", "Baki"
- "TEGASAN / HIGHLIGHTS", "RINGKASAN / SUMMARY", "Jumlah Debit", "Jumlah Kredit"
- Repeated page headers: bank names (e.g., "PUBLIC BANK"), branch addresses, account holder names, account numbers — these appear on every page
- "This is a computer generated statement", "No signature is required"
- "PeeBee Tip" and any illustrated tip boxes
- Legal disclaimers, privacy policies, anti-corruption notices (usually on last page)
- "Page X of Y" or page number indicators
- Lines with only a running balance number and no transaction description

## OUTPUT FORMAT
Return a JSON array of objects. Each object MUST have exactly these fields:
- "idx": Sequential integer starting from 1.
- "date": YYYY-MM-DD format.
- "description": Full combined multi-line description (max 100 chars). Include the payee name from continuation lines.
- "debit_amount": number, 0 if credit. Never negative.
- "credit_amount": number, 0 if debit. Never negative.
- "category": "Payment" | "Credit/Deposit" | "Fund Transfer" | "Bank Fee" | "Interest" | "Other"
- "payee": Person/company name from description. Strip codes and numbers. "" if none.

CRITICAL:
1. Extract EVERY transaction — no skipping, no summarizing
2. Each transaction code line = one transaction. Continuation lines = part of the same.
3. Return ONLY valid JSON array — no markdown, no code blocks`;

// ─── Post-extraction validator: cross-check DR/CR/CDT against amounts ───
function validateAndCorrect(transactions, rawText) {
  const corrections = [];
  // Normalize raw text for amount extraction
  const lines = rawText.split('\n');

  for (const tx of transactions) {
    const desc = (tx.description || '').toUpperCase();

    // Detect transaction type from description keywords
    const isDebit = /\b(DR|TRSF\s*DR|DUITNOW\s+TRSF\s+DR|GIRO\s+PYMT|FPX|TSFR\s+FUND\s+DR|CHEQUE\s+PROCESS\s+FEE|LEMBAGA\s+HASIL)\b/i.test(desc);
    const isCredit = /\b(CR|CDT|TRSF\s*CR|DUITNOW\s+TRSF\s+CR|DEP[- ]?CASH)\b/i.test(desc);

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
  if (/\b(CHEQUE\s+PROCESS\s+FEE|BANK\s+FEE|SERVICE\s+FEE|CHARGE|COMMISSION)\b/.test(d)) return 'Bank Fee';
  if (/\b(DUITNOW|TRSF|GIRO|FPX|IBG|TRANSFER)\b/.test(d)) return 'Fund Transfer';
  if (/\b(INTEREST|DIVIDEND)\b/.test(d)) return 'Interest';
  if (/\b(EPF|SOCSO|KWSP|PERKESO|LHDN|LEMBAGA\s+HASIL|CUKAI)\b/.test(d)) return 'Payment';
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
  const model = 'gemini-3.5-flash';
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
    let provider = preferredProvider || 'gemini';

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
