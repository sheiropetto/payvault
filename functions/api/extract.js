import { authenticate } from '../utils/auth';
import { toProperFilename } from './bank-statements/index';

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


// ─── Call Gemini API (fallback) ───
async function callGemini(apiKey, pdfText) {
  const model = 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let lastErr = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: SYSTEM_PROMPT + '\n\n' + `Extract ALL transactions from this bank statement. Return ONLY a JSON array.\n\nRaw text:\n\n${pdfText.slice(0, 80000)}` }]
          }],
          generationConfig: { temperature: 0.05 }
        }),
        signal: AbortSignal.timeout(30000), // Reduce timeout to 30s to fit within Cloudflare's request limits
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
        throw new Error(`Gemini returned 0 transactions. Raw response: ${content ? content.slice(0, 150) : 'empty'}`);
      }

      return { transactions, provider: 'gemini', usage: data.usageMetadata };
    } catch (err) {
      lastErr = err;
      console.warn(`[Gemini API] Attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < maxRetries) {
        // Wait 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastErr;
}

// ─── Programmatic CSV parsing helpers ───
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  return lines;
}

function normalizeDate(rawDate) {
  if (!rawDate) return null;
  const cleaned = rawDate.replace(/['"]+/g, '').trim();
  if (!cleaned) return null;

  // Try standard YYYY-MM-DD or YYYY/MM/DD
  let match = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  match = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  // Try DD/MM/YY or DD-MM-YY (e.g. 23/05/23)
  match = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (match) {
    const year = parseInt(match[3]) < 50 ? `20${match[3]}` : `19${match[3]}`;
    return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  // Try DD MMM YYYY or DD-MMM-YY (e.g., "15 Jul 2023", "15-Jul-23", "15 July 2023")
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  const parts = cleaned.split(/[\s\-_]+/);
  if (parts.length >= 3) {
    const day = parts[0].replace(/\D/g, '');
    const monStr = parts[1].toLowerCase();
    let yearStr = parts[2].replace(/\D/g, '');

    if (day && months[monStr] && yearStr) {
      if (yearStr.length === 2) {
        yearStr = parseInt(yearStr) < 50 ? `20${yearStr}` : `19${yearStr}`;
      }
      return `${yearStr}-${months[monStr]}-${day.padStart(2, '0')}`;
    }
  }

  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return null;
}

function parseAmount(val) {
  if (!val) return 0;
  let cleaned = val.replace(/[^0-9.\-()]/g, '').trim();
  if (!cleaned) return 0;

  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function findHeaderAndMap(rows) {
  const dateKeywords = ['date', 'tarikh', 'value date', 'trn date', 'posting date'];
  const descKeywords = ['description', 'transaction description', 'details', 'transaction details', 'remarks', 'description / payee', 'description/payee'];
  const particularsKeywords = ['particulars', 'butiran_transaksi', 'butiran'];
  const payeeKeywords = ['to', 'payee', 'beneficiary', 'recipient', 'penerima'];
  const categoryKeywords = ['category', 'kategori'];
  const debitKeywords = ['debit', 'withdrawal', 'amount out', 'out', 'payment', 'charges'];
  const creditKeywords = ['credit', 'deposit', 'amount in', 'in', 'received'];
  const amountKeywords = ['amount', 'amount (rm)', 'jumlah', 'transaction amount'];

  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r].map(c => c.trim().toLowerCase());
    
    let dateIdx = -1;
    let descIdx = -1;
    let particularsIdx = -1;
    let payeeIdx = -1;
    let categoryIdx = -1;
    let debitIdx = -1;
    let creditIdx = -1;
    let amountIdx = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;

      if (dateIdx === -1 && dateKeywords.some(kw => cell.includes(kw))) dateIdx = c;
      else if (descIdx === -1 && descKeywords.some(kw => cell.includes(kw))) descIdx = c;
      else if (particularsIdx === -1 && particularsKeywords.some(kw => cell.includes(kw))) particularsIdx = c;
      else if (payeeIdx === -1 && payeeKeywords.some(kw => cell.includes(kw))) payeeIdx = c;
      else if (categoryIdx === -1 && categoryKeywords.some(kw => cell.includes(kw))) categoryIdx = c;
      else if (debitIdx === -1 && debitKeywords.some(kw => cell.includes(kw))) debitIdx = c;
      else if (creditIdx === -1 && creditKeywords.some(kw => cell.includes(kw))) creditIdx = c;
      else if (amountIdx === -1 && amountKeywords.some(kw => cell.includes(kw))) amountIdx = c;
    }

    // Fallback description index to particulars index if description is missing
    if (descIdx === -1 && particularsIdx !== -1) {
      descIdx = particularsIdx;
      particularsIdx = -1;
    }

    if (dateIdx !== -1 && descIdx !== -1 && (amountIdx !== -1 || debitIdx !== -1 || creditIdx !== -1)) {
      return {
        headerRowIndex: r,
        mapping: { dateIdx, descIdx, particularsIdx, payeeIdx, categoryIdx, debitIdx, creditIdx, amountIdx }
      };
    }
  }
  return null;
}

function cleanPayeeName(desc) {
  if (!desc) return '';
  let cleaned = desc.toUpperCase();
  const prefixesToRemove = [
    /\b(TSFR|FUND|CR|DR|DUITNOW|TRSF|GIRO|PYMT|FPX|DEP-CASH|CDT|IBG|ATM|CASH)\b/g,
    /\b(ATM-EFT|PROCESS|FEE|LEMBAGA|HASIL|DALAM|NEGERI)\b/g,
    /\d{5,}/g,
    /[^A-Z0-9\s]/g
  ];
  for (const pattern of prefixesToRemove) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 50).trim();
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

    const { statement_id, text, provider: preferredProvider, chunk_index, total_chunks } = await request.json();
    if (!statement_id) {
      return Response.json({ error: 'statement_id required' }, { status: 400 });
    }

    const stmt = await env.DB.prepare(
      'SELECT * FROM bank_statements WHERE id = ?'
    ).bind(statement_id).first();

    if (!stmt) {
      return Response.json({ error: 'Statement not found' }, { status: 404 });
    }

    // If first chunk or not chunked, clean up existing transactions and reset status
    if (chunk_index === undefined || chunk_index === 0) {
      // Unlink voucher_transactions
      const { results: linked } = await env.DB.prepare(
        `SELECT DISTINCT vt.voucher_id, vt.transaction_id
         FROM voucher_transactions vt
         JOIN transactions t ON t.id = vt.transaction_id
         WHERE t.bank_statement_id = ?`
      ).bind(statement_id).all();

      for (const { voucher_id, transaction_id } of linked) {
        await env.DB.prepare('DELETE FROM voucher_transactions WHERE voucher_id = ? AND transaction_id = ?')
          .bind(voucher_id, transaction_id).run();
      }

      // Delete transactions
      await env.DB.prepare(
        'DELETE FROM transactions WHERE bank_statement_id = ?'
      ).bind(statement_id).run();

      // Update status to processing
      await env.DB.prepare(
        "UPDATE bank_statements SET status = 'processing' WHERE id = ?"
      ).bind(statement_id).run();
    }

    let csvText = '';
    let pdfText = '';

    if (stmt.file_type === 'csv') {
      const fileObj = await env.STORAGE.get(stmt.file_url);
      if (!fileObj) {
        await env.DB.prepare("UPDATE bank_statements SET status = 'error' WHERE id = ?").bind(statement_id).run();
        return Response.json({ error: 'File not found in storage' }, { status: 404 });
      }
      const fileBuffer = await fileObj.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);
      const decoder = new TextDecoder('utf-8', { fatal: false });
      csvText = decoder.decode(fileBytes);
    } else {
      pdfText = text;
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
    }

    let transactions = [];
    let provider = 'system';
    let corrections = [];

    if (stmt.file_type === 'csv') {
      const rows = parseCSV(csvText);
      const headerInfo = findHeaderAndMap(rows);
      if (!headerInfo) {
        throw new Error('Could not identify a valid transaction table header in the CSV. Make sure the CSV contains Date, Description, and Amount/Debit/Credit columns.');
      }

      const { headerRowIndex, mapping } = headerInfo;
      const { dateIdx, descIdx, particularsIdx, payeeIdx, categoryIdx, debitIdx, creditIdx, amountIdx } = mapping;

      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= Math.max(dateIdx, descIdx)) continue;

        const rawDate = row[dateIdx];
        const normalized = normalizeDate(rawDate);
        if (!normalized) continue; // skip rows without a valid date (like spacer/total rows)

        const description = (row[descIdx] || '').trim();
        if (!description) continue; // skip empty transactions

        let debit_amount = 0;
        let credit_amount = 0;

        if (debitIdx !== -1 || creditIdx !== -1) {
          debit_amount = debitIdx !== -1 ? parseAmount(row[debitIdx]) : 0;
          credit_amount = creditIdx !== -1 ? parseAmount(row[creditIdx]) : 0;
        } else if (amountIdx !== -1) {
          const amt = parseAmount(row[amountIdx]);
          if (amt < 0) {
            debit_amount = Math.abs(amt);
          } else {
            credit_amount = amt;
          }
        }

        // Extract particulars, payee/TO, and category if they exist
        let particulars = '';
        if (particularsIdx !== -1 && row[particularsIdx]) {
          particulars = row[particularsIdx].trim();
        } else {
          particulars = debit_amount > 0 ? 'Payment' : 'Deposit';
        }

        let payee = '';
        if (payeeIdx !== -1 && row[payeeIdx]) {
          payee = row[payeeIdx].trim();
        } else {
          payee = cleanPayeeName(description);
        }

        let category = '';
        if (categoryIdx !== -1 && row[categoryIdx]) {
          category = row[categoryIdx].trim();
        }

        const standardCategories = ['Payment', 'Credit/Deposit', 'Fund Transfer', 'Bank Fee', 'Interest', 'Other'];
        if (category) {
          const catLower = category.toLowerCase();
          if (catLower === 'income' || catLower === 'deposit') {
            category = 'Credit/Deposit';
          } else if (catLower === 'payment' || catLower === 'cheque' || catLower === 'loan payment') {
            category = 'Payment';
          } else if (catLower === 'fund transfer') {
            category = 'Fund Transfer';
          } else if (catLower === 'bank fee' || catLower === 'cheque fee') {
            category = 'Bank Fee';
          } else if (catLower === 'interest') {
            category = 'Interest';
          } else if (!standardCategories.includes(category)) {
            category = guessCategory(description);
          }
        } else {
          category = guessCategory(description);
        }

        // Force credit transactions to Credit/Deposit category if they ended up under Payment/Other
        if (credit_amount > 0 && (!category || category === 'Payment' || category === 'Other')) {
          category = 'Credit/Deposit';
        }

        transactions.push({
          idx: transactions.length + 1,
          date: normalized,
          description: description.slice(0, 100),
          debit_amount,
          credit_amount,
          category,
          payee,
          particulars
        });
      }
    } else {
      // ─── Use Gemini API ───
      if (!env.GEMINI_API_KEY) {
        return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
      }
      const result = await callGemini(env.GEMINI_API_KEY, pdfText);
      provider = 'gemini';
      transactions = result.transactions;
      transactions.sort((a, b) => (a.idx || 0) - (b.idx || 0));
      corrections = validateAndCorrect(transactions, pdfText);
    }

    // Insert into DB (no balance column)
    const insertStmt = env.DB.prepare(
      `INSERT INTO transactions (bank_statement_id, date, description, debit_amount, credit_amount, category, payee, particulars)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let insertedCount = 0;
    for (const tx of transactions) {
      try {
        // Fallback particulars for non-CSV (Gemini) entries
        const txParticulars = tx.particulars || ((tx.debit_amount || 0) > 0 ? 'Payment' : 'Deposit');
        await insertStmt.bind(
          statement_id,
          tx.date,
          tx.description,
          tx.debit_amount || 0,
          tx.credit_amount || 0,
          tx.category || 'Other',
          tx.payee || '',
          txParticulars
        ).run();
        insertedCount++;
      } catch (e) {
        console.error('Skipping transaction:', e.message);
      }
    }

    // Finalize statement metadata on last chunk or if not chunked
    const isLastChunk = chunk_index === undefined || total_chunks === undefined || chunk_index === total_chunks - 1;
    if (isLastChunk) {
      const { results: allTx } = await env.DB.prepare(
        'SELECT date FROM transactions WHERE bank_statement_id = ? ORDER BY date ASC LIMIT 1'
      ).bind(statement_id).all();

      const firstDate = allTx[0]?.date || '';
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
        message: stmt.file_type === 'csv'
          ? `[System] Programmatically extracted ${insertedCount} transactions`
          : corrections.length > 0
            ? `[${provider}] Extracted ${insertedCount} transactions · Auto-corrected ${corrections.length} amount(s)`
            : `[${provider}] Successfully extracted ${insertedCount} transactions`,
      });
    } else {
      return Response.json({
        success: true,
        provider,
        total_extracted: transactions.length,
        total_inserted: insertedCount,
        corrections: corrections.length,
        message: stmt.file_type === 'csv'
          ? `[System] Extracted chunk ${chunk_index + 1} of ${total_chunks}`
          : `[${provider}] Extracted chunk ${chunk_index + 1} of ${total_chunks}`,
      });
    }

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
