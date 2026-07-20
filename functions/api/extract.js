import { authenticate } from '../utils/auth';
import { toProperFilename } from './bank-statements/index';

const SYSTEM_PROMPT = `Act as an expert data extraction engine specializing in financial documents. You are categorizing pre-parsed Malaysian bank statement transactions.

## INPUT FORMAT
You will receive transactions in this clean format, one per line:
  [IDX] DD/MM | TYPE | AMOUNT | DESCRIPTION

Where:
- IDX = sequential number (preserve this exact index in output)
- DD/MM = transaction date (day/month)
- TYPE = "DEBIT" or "CREDIT" (already determined — DO NOT change this)
- AMOUNT = the exact transaction amount (already verified — DO NOT change this)
- DESCRIPTION = raw transaction description text

## YOUR TASK
For each transaction, you must:
1. Keep the IDX, date, type, and amount EXACTLY as provided. DO NOT modify them.
2. Assign a "category" based on the description
3. Extract a clean "payee" name from the description

## CATEGORY RULES
- "CHQ PROCESS FEE" or "CHEQUE PROCESS FEE" → category: "Bank Fee"
- "AUTOMATED LOAN PYMT" → category: "Payment"
- "DUITNOW TRSF DR", "DUITNOW TRSF CR", "GIRO PYMT", "FPX" → category: "Fund Transfer"
- "TSFR FUND DR", "TSFR FUND CR" → category: "Fund Transfer"
- "DR-ECP" with LEMBAGA HASIL/EPF/KWSP/SOCSO/PERKESO → category: "Payment"
- "DEP-CASH", "DEP-ECP" → category: "Credit/Deposit"
- "CHEQ" (not CHQ PROCESS FEE) → category: "Payment"
- If description contains "SALARY", "PAYMENT", "RENTAL", "CLAIM", "EXPENSES", "INSTALLMENT" → category: "Payment"
- Otherwise: use "Fund Transfer" for DUITNOW/TRSF/IBG, "Payment" for general debits

## PAYEE EXTRACTION RULES
Extract the payee name from the description:
- For "TSFR FUND DR-ATM/EFT XXXXXX ACCOUNT_NUM PAYEE_NAME..." → extract PAYEE_NAME
- For "DUITNOW TRSF DR XXXXXX PAYEE_NAME..." → extract PAYEE_NAME  
- For "GIRO PYMT-ATM/EFT XXXXXX PAYEE_NAME..." → extract PAYEE_NAME
- For "DR-ECP XXXXXX... LEMBAGA HASIL DALAM NEGERI..." → payee: "LEMBAGA HASIL DALAM NEGERI"
- For "DR-ECP XXXXXX... KUMPULAN WANG SIMPANAN PEKERJA..." → payee: "KUMPULAN WANG SIMPANAN PEKERJA"
- For "DR-ECP XXXXXX... PERTUBUHAN KESELAMATAN SOSIAL..." → payee: "PERTUBUHAN KESELAMATAN SOSIAL"
- For "CHEQ NNNNNN" → payee: "" (unknown cheque recipient)
- For "CHQ PROCESS FEE" → payee: ""
- For "AUTOMATED LOAN PYMT" → payee: ""
- For "FPX - XXXX" → payee: ""
- For "DEP-CASH" → payee: ""
- Strip account numbers (like "3149XXXXXX", "4889XXXXXX", "3218XXXXXX"), reference numbers, and transaction codes from payee
- Payee should be a clean person or company name, max 50 chars
- If no payee can be determined, use ""

## OUTPUT FORMAT EXAMPLE (FICTITIOUS — DO NOT COPY THESE INTO YOUR OUTPUT)
These are FORMAT ILLUSTRATIONS ONLY. They use impossible dates/amounts and fake names. NEVER include these in your response.

Input:
[1] 99/99 | DEBIT | 9999.99 | TSFR FUND DR-ATM/EFT 999999 9999XXXXXX EXAMPLE PAYEE NAME
[2] 99/99 | CREDIT | 8888.88 | TSFR FUND CR-ATM/EFT 888888 8888XXXXXX EXAMPLE COMPANY NAME

Output:
[
  {"idx":1,"date":"2099-12-31","description":"TSFR FUND DR-ATM/EFT 999999 EXAMPLE PAYEE NAME","debit_amount":9999.99,"credit_amount":0,"category":"Fund Transfer","payee":"EXAMPLE PAYEE NAME"},
  {"idx":2,"date":"2099-12-31","description":"TSFR FUND CR-ATM/EFT 888888 EXAMPLE COMPANY NAME","debit_amount":0,"credit_amount":8888.88,"category":"Credit/Deposit","payee":"EXAMPLE COMPANY NAME"}
]

## CRITICAL RULES
1. Return EXACTLY the same number of transactions as the input below. NO skipping, NO adding, NO inventing. Only process transactions that appear in the input — NEVER include the format example transactions (they use fake 99/99 dates).
2. The IDX in your output MUST match the IDX in the input.
3. The date, type (debit/credit), and amount MUST match the input exactly.
4. DEBIT transactions: set debit_amount = input amount, credit_amount = 0
5. CREDIT transactions: set credit_amount = input amount, debit_amount = 0
6. Description: use the clean version (strip excessive reference numbers, keep it readable, max 150 chars)
7. Return ONLY a valid JSON array — no markdown, no code blocks, no explanation text.

## DATE FORMAT
- Clean format: Convert DD/MM to YYYY-MM-DD using the year from "Statement year:" header.
- Raw format: Infer year from "Statement Date" or "Tarikh Penyata" in the text.

## FALLBACK: RAW TEXT PARSING
If you receive raw statement text (not the clean [IDX] format), parse it using these rules:
- Lines with DD/MM AMOUNT BALANCE are transaction starts
- Balance going DOWN = DEBIT, balance going UP = CREDIT
- CHEQ lines: the amount is the cheque value (could be large). CHQ PROCESS FEE is a separate small fee.
- NEVER swap amounts between adjacent transactions.
- NEVER skip credit transactions — they have "CR" or "CDT" in the description.
- FPX lines with no balance change are NOT transactions — skip them.
- DEP-CASH, DEP-ECP are CREDITS.
- DR-ECP is always DEBIT.
- Extract EVERY transaction visible in the statement — aim for the count mentioned in the summary (e.g., "56 debits, 16 credits").

## ANTI-HALLUCINATION (CRITICAL)
The format example above uses FAKE DATA (dates 99/99, amounts 9999.99, names like EXAMPLE). These are NOT real transactions. If your output contains ANY transaction with payee "EXAMPLE", date "2099", or amount 9999.99, you have FAILED. Only output transactions from the ACTUAL input text below.`;

// ─── Pre-processor: parse Public Bank raw text into clean structured transactions ───
// Uses the RUNNING BALANCE as ground truth to determine debit/credit and amounts.
// Handles the space-joined format from pdf.js where newlines are lost.
function preprocessPublicBankText(rawText) {
  // Ported from Python pypdf parser — processes line-by-line using
  // the new pdf.js Y-coordinate grouped text format.
  const lines = rawText.split('\n');

  // pdf.js Y-grouped format: DD/MM DESC...AMOUNT BALANCE (amounts at END of line)
  // Also handles pypdf format: DD/MM AMOUNT BALANCEDESC
  // Strategy: capture last two [\d,]+\.\d{2} as amount+balance, everything before as desc/date
  const txWithDate = /^(\d{2}\/\d{2})\s+(.*?)([\d,]+\.\d{2})\s*([\d,]+\.\d{2})\s*$/;
  const txNoDate = /^(.*?)([\d,]+\.\d{2})\s*([\d,]+\.\d{2})\s*$/;

  const TX_CODES = /\b(TSFR|DUITNOW|GIRO|DR-ECP|DEP-ECP|CHEQ|CHQ|LOAN|AUTOMATED|FPX|IBG|ATM|DEP-CASH|RMT|MISC|KUMPULAN|PERTUBUHAN|LEMBAGA|MAXIS)\b/i;

  const SKIP_LINE = /^(TEGASAN|RINGKASAN|Jumlah|Baki|This is a computer|No signature|PeeBee|Page \d|PENYATA|Nombor|Jenis|Tarikh|Muka|Dilindungi|Protected|Terima|Thank|Your banking|Anda boleh|You may|PERHATIAN|Dimaklumkan|Please be|sifar|tolerance|DATE TRANSACTION|TARIKH URUS|RAZ UTAMA|KL CITY|GRD FLOOR|BOX \d|TEL:|\. |Join the|Campaign|^\d+$)/i;

  const entries = [];
  let currentDate = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || (SKIP_LINE.test(line) && !(entries.length > 0 && /\bRAZ\s+UTAMA\b/i.test(line)))) continue;

    // Try date + desc + amount + balance (pdf.js format: desc before amounts)
    let m = txWithDate.exec(line);
    if (m) {
      currentDate = m[1];
      let desc = (m[2] || '').trim();
      const amount = parseFloat(m[3].replace(/,/g, ''));
      const balance = parseFloat(m[4].replace(/,/g, ''));

      if (desc && desc.length >= 2 && TX_CODES.test(desc)) {
        entries.push({ dateStr: currentDate, amount, balance, desc });
      }
      continue;
    }

    // Try desc + amount + balance (no date)
    m = txNoDate.exec(line);
    if (m && currentDate) {
      let desc = (m[1] || '').trim();
      const amount = parseFloat(m[2].replace(/,/g, ''));
      const balance = parseFloat(m[3].replace(/,/g, ''));

      if (desc && desc.length >= 2) {
        if (/^Balance/i.test(desc)) continue;

        if (TX_CODES.test(desc)) {
          // New transaction on same date
          entries.push({ dateStr: currentDate, amount, balance, desc });
        } else if (entries.length > 0) {
          // Continuation line — append to previous description
          entries[entries.length - 1].desc += ' ' + desc;
        }
      }
      continue;
    }

    // Bare continuation line (reference numbers, etc.) — append to last entry
    // But skip footer/boilerplate text that shouldn't be part of any transaction
    if (entries.length > 0 && line.length > 2 && !/^[\d,]+\.\d{2}/.test(line)) {
      // Footer text patterns — don't append to descriptions
      if (/^(Balance\s+C\/F|Closing\s+Balance|Penyata\s+ini\s+dicetak|Tandatangan\s+tidak|This\s+is\s+a\s+computer|No\s+signature|Baki\s+Harian|Daily\s+And\s+Closing|Terima\s+Kasih|Thank\s+You\s+For|Anda\s+boleh|You\s+may|PERHATIAN|Dimaklumkan|Please\s+be\s+informed)/i.test(line)) continue;
      entries[entries.length - 1].desc += ' ' + line;
    }
  }

  if (entries.length < 3) return null;

  // Add Balance From Last Statement as reference for first transaction
  const bflMatch = rawText.match(/Balance\s+From\s+Last\s+Statement\s+([\d,]+\.\d{2})/i);
  if (bflMatch) {
    entries.unshift({
      dateStr: entries[0]?.dateStr || '01/01',
      amount: 0,
      balance: parseFloat(bflMatch[1].replace(/,/g, '')),
      desc: 'BALANCE_FROM_LAST_STATEMENT',
      _isReference: true,
    });
  }

  // Determine DR/CR using balance chain (same logic as Python parser)
  const transactions = [];
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    if (cur._isReference) continue;
    const prev = entries[i - 1];
    const descUpper = cur.desc.toUpperCase();

    let type, txAmount;

    if (prev) {
      const delta = cur.balance - prev.balance;
      if (delta < -0.005) {
        type = 'DEBIT';
        txAmount = Math.abs(delta);
      } else if (delta > 0.005) {
        type = 'CREDIT';
        txAmount = delta;
      } else {
        // Balance unchanged — check description keywords
        if (/\b(CR|CDT|DEP[- ])/i.test(descUpper)) {
          type = 'CREDIT';
          txAmount = cur.amount;
        } else if (/\b(DR|PYMT|FEE|FPX|GIRO|LOAN|TRSF)\b/i.test(descUpper)) {
          type = 'DEBIT';
          txAmount = cur.amount;
        } else {
          continue;
        }
      }
    } else {
      // First entry: trust description keywords
      type = /\b(CR|CDT|DEP[- ])/i.test(descUpper) ? 'CREDIT' : 'DEBIT';
      txAmount = cur.amount;
    }

    if (txAmount < 0.005) continue;

    transactions.push({
      idx: transactions.length + 1,
      dateStr: cur.dateStr,
      type,
      amount: parseFloat(txAmount.toFixed(2)),
      rawDescription: cur.desc,
    });
  }

  return transactions.length >= 3 ? transactions : null;
}

// ─── Merge pre-processed amounts/dates with AI categories/payees ───
function mergePreprocessedWithAI(preprocessed, aiTransactions, rawText) {
  // Extract year from raw text
  const yearHint = rawText.match(/(?:Statement Date|Tarikh Penyata).*?(\d{4})/);
  const year = yearHint ? yearHint[1] : new Date().getFullYear().toString();

  // Build a map of AI results by idx
  const aiMap = new Map();
  if (Array.isArray(aiTransactions)) {
    for (const aiTx of aiTransactions) {
      const idx = aiTx.idx;
      if (idx != null) aiMap.set(idx, aiTx);
    }
  }

  // Merge: pre-processed data provides authoritative amounts, AI provides categories and payees
  const merged = [];
  for (const ppTx of preprocessed) {
    const aiTx = aiMap.get(ppTx.idx);

    // Convert DD/MM to YYYY-MM-DD
    const [day, month] = ppTx.dateStr.split('/');
    const date = `${year}-${month}-${day}`;

    const isDebit = ppTx.type === 'DEBIT';
    const debitAmount = isDebit ? ppTx.amount : 0;
    const creditAmount = isDebit ? 0 : ppTx.amount;

    // Use AI category and payee if available, otherwise compute defaults
    const category = (aiTx && aiTx.category)
      ? aiTx.category
      : guessCategory(ppTx.rawDescription);

    const payee = (aiTx && aiTx.payee != null)
      ? aiTx.payee
      : extractPayee(ppTx.rawDescription);

    // Use AI description if available and not empty, otherwise use raw description
    const aiDesc = (aiTx && aiTx.description) ? aiTx.description : '';
    const description = aiDesc || ppTx.rawDescription.slice(0, 150);

    merged.push({
      idx: ppTx.idx,
      date,
      description,
      debit_amount: parseFloat(debitAmount.toFixed(2)),
      credit_amount: parseFloat(creditAmount.toFixed(2)),
      category: category || (isDebit ? 'Payment' : 'Credit/Deposit'),
      payee: payee || '',
      particulars: isDebit ? 'Payment' : 'Deposit',
    });
  }

  return merged;
}

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
  const model = 'gemini-1.5-flash';
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
        signal: AbortSignal.timeout(55000), // 55s to stay within Cloudflare's 60s subrequest limit
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

// ─── Call DeepSeek API (primary) ───
async function callDeepSeek(apiKey, pdfText) {
  const model = 'deepseek-chat';
  const url = 'https://api.deepseek.com/v1/chat/completions';

  let lastErr = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: SYSTEM_PROMPT + '\n\n' + `Extract ALL transactions from this bank statement. Return ONLY a JSON array.\n\nRaw text:\n\n${pdfText.slice(0, 80000)}`
          }],
          temperature: 0,
          max_tokens: 8192
        }),
        signal: AbortSignal.timeout(55000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`DeepSeek API error (${res.status}): ${errText.slice(0, 500)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('DeepSeek returned empty response');

      // DeepSeek sometimes wraps JSON in ```json blocks — strip it
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      // Strip COUNT line if present
      cleaned = cleaned.replace(/^COUNT:\s*\d+\s*\n?/im, '').trim();

      const transactions = parseTransactions(cleaned);
      if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        throw new Error(`DeepSeek returned 0 transactions. Raw response: ${content.slice(0, 150)}`);
      }

      // Normalize amounts: ensure 2 decimal places
      for (const tx of transactions) {
        if (typeof tx.debit_amount === 'number') tx.debit_amount = parseFloat(tx.debit_amount.toFixed(2));
        if (typeof tx.credit_amount === 'number') tx.credit_amount = parseFloat(tx.credit_amount.toFixed(2));
      }

      return { transactions, provider: 'deepseek', usage: data.usage };
    } catch (err) {
      lastErr = err;
      console.warn(`[DeepSeek API] Attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < maxRetries) {
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

// ─── Smart payee extraction: pattern-based per transaction type ───
const PURPOSE_KEYWORDS = [
  "PAYMENT", "PYMT", "PETTY CASH", "PETTYCASH", "SALARY", "CLAIM", "RENTAL", 
  "INSTALLMENT", "EXPENSES", "ALLOWANCE", "CERT", "FEE", "COURSE", "SERVICE", 
  "DOWNPYMT", "PARKING", "CHECK SOLAR", "BIL TM", "INSOLVENSI", "ELAUN", 
  "CLEANER", "MONTLY", "TENDER", "AUDIT", "ROADTAX", "INSURANCE", "PRINT", 
  "COMPANY", "PROFILE", "SABAH", "TIKET", "GALA", "DINNER", "SPAN", "HSE", 
  "LOAN", "SCORE", "PRINTER", "IMIGRESEN", "MASSIVE", "OFFICE", "CYBER", 
  "TNB", "INDAH WATER", "IWK", "PETTY", "CASH", "BIL", "CTC", "AZ", "FOR", 
  "ICE", "NATHAN", "TRANSFER", "FUND", "JAN", "FEB", "MAR", "APR", "MAY", 
  "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN24", "JANUARY", 
  "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST", "SEPTEMBER", 
  "OCTOBER", "NOVEMBER", "DECEMBER", "DUIT RAYA", "DUITRAYA"
];

const purposePattern = new RegExp('\\s+\\b(' + PURPOSE_KEYWORDS.join('|') + ')\\b.*', 'i');

function cleanExtractedName(name) {
  // Strip common system identifiers / references
  name = name.replace(/MYCN\d+.*/i, '');
  name = name.replace(/DUITNOW\s*\(.*/i, '');
  name = name.replace(/Balance\s+C\/F.*/i, '');
  
  // Strip purpose and trailing text
  name = name.replace(purposePattern, '');
  
  // Strip any alphanumeric reference codes (must contain BOTH letters and digits, and be length >= 5)
  name = name.replace(/\s+\b(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9_-]{5,}\b.*$/i, '');
  
  // Clean up double spaces
  name = name.replace(/\s+/g, ' ').trim();
  
  // Apply name mappings/corrections for truncated payees
  const mappings = {
    'MUHAMMAD RAIMIEY BIN': 'MUHAMMAD RAIMIEY',
    'FARZIEYANA BINTI MOH': 'FARZIEYANA BINTI MOHD ARIFF',
    'SITI MARDIANASARI BI': 'SITI MARDIANASARI',
    'AILYN BINTI ABD.MAJI': 'AILYN BINTI ABD MAJID'
  };
  const upperName = name.toUpperCase();
  if (mappings[upperName]) {
    return mappings[upperName];
  }
  
  return name;
}

// ─── Smart payee extraction: pattern-based per transaction type ───
function extractPayee(desc) {
  if (!desc) return '';
  const d = desc.trim();
  const du = d.toUpperCase();

  // ── Known entity lookup (cleaned names from existing good data) ──
  const knownEntities = {
    'LEMBAGA HASIL DALAM NEGERI': 'LEMBAGA HASIL DALAM NEGERI',
    'KUMPULAN WANG SIMPANAN PEKERJA': 'KUMPULAN WANG SIMPANAN PEKERJA',
    'PERTUBUHAN KESELAMATAN SOSIAL': 'PERTUBUHAN KESELAMATAN SOSIAL',
    'LEMBAGA PEMBANGUNAN INDUSTRI': 'LEMBAGA PEMBANGUNAN INDUSTRI',
  };

  for (const [key, val] of Object.entries(knownEntities)) {
    if (du.includes(key)) return val;
  }

  // ── DR-ECP / DEP-ECP ──
  if (/\bDR-ECP\b/.test(du)) {
    const m = du.match(/DR-ECP\s+\d+(?:\s+\d+)?\s*(.*)/);
    if (m) return cleanExtractedName(m[1]);
  }
  if (/\bDEP-ECP\b/.test(du)) {
    const m = du.match(/DEP-ECP\s+\d+\s*(.*)/);
    if (m) {
      let name = m[1];
      // Strip long prefix codes (like IMEPS20240422100002189924882)
      name = name.replace(/^[A-Z0-9]{15,}\s+/, '');
      // Strip bank prefix if any
      name = name.replace(/^(RHB|MBB|PBB|CIMB)\s+/i, '');
      return cleanExtractedName(name);
    }
  }

  // ── DUITNOW TRSF DR/CR ──
  let m = du.match(/DUITNOW\s+TRSF\s+(?:DR|CR)\s+(?:\d{6}\s+)?(.+)/);
  if (m) {
    return cleanExtractedName(m[1]);
  }

  // ── TSFR FUND DR/CR-ATM/EFT ──
  m = du.match(/TSFR\s+FUND\s+(?:DR|CR)(?:-ATM\/EFT)?\s+(?:\d{6}\s+)?(?:\w*X{2,}\w*\s+)?(.+)/);
  if (m) {
    let name = m[1];
    name = name.replace(/^(IBG|SCB|CGB|WARRANT|TRANSFER|EFT)\s+/i, '');
    return cleanExtractedName(name);
  }

  // ── GIRO PYMT-ATM/EFT ──
  m = du.match(/GIRO\s+PYMT-ATM\/EFT\s+\d*\s*(.+)/);
  if (m) {
    let name = m[1];
    if (/\bJOMPAY\b/.test(name)) return '';
    return cleanExtractedName(name);
  }

  // ── RMT CR → KENANGA INVESTMENT BANK ──
  if (/\bRMT\s+CR\b/.test(du)) return 'KENANGA INVESTMENT BANK BERHAD';

  // ── RMT DR / RMT CHRG DR → empty (bank fee) ──
  if (/\bRMT\s+(DR|CHRG)\b/.test(du)) return '';

  // ── AUTOMATED LOAN PYMT → empty ──
  if (/\bAUTOMATED\s+LOAN\b/.test(du)) return '';

  // ── CHQ PROCESS FEE / CHEQUE PROCESS FEE → empty ──
  if (/\bCH(E)?Q(UE)?\s+PROCESS\s+FEE\b/i.test(du)) return '';

  // ── CHEQ NNNNNN → empty (unknown recipient) ──
  if (/^CHEQ\s+\d+/i.test(du)) return '';

  // ── MISC DR → empty ──
  if (/\bMISC\s+DR\b/.test(du)) return '';

  // ── DEP-CASH → empty ──
  if (/\bDEP-CASH\b/.test(du)) return '';

  // ── FPX → empty ──
  if (/\bFPX\b/.test(du)) return '';

  // Fallback to cleanPayeeName
  return cleanPayeeName(desc);
}

function cleanPayeeName(desc) {
  if (!desc) return '';
  let cleaned = desc.toUpperCase();
  const prefixesToRemove = [
    /\b(TSFR|FUND|CR|DR|DUITNOW|TRSF|GIRO|PYMT|FPX|DEP-CASH|CDT|IBG|ATM|CASH)\b/g,
    /\b(ATM-EFT|PROCESS|FEE|LEMBAGA|HASIL|DALAM|NEGERI)\b/g,
    /\d{5,}/g,
    /[^A-Z0-9\s.\-/&]/g
  ];
  for (const pattern of prefixesToRemove) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  cleaned = cleanExtractedName(cleaned);
  return cleaned;
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
      // ─── AI-powered PDF extraction ───
      const selectedProvider = (preferredProvider || 'preprocessor').toLowerCase();

      // Try pre-processor for amount accuracy; fall back to raw text if it fails
      const preprocessed = preprocessPublicBankText(pdfText);
      let usePreprocessor = false;
      let aiPromptText = pdfText;

      if (preprocessed && preprocessed.length >= 5) {
        usePreprocessor = true;
        const yearHint = pdfText.match(/(?:Statement Date|Tarikh Penyata).*?(\d{4})/);
        const year = yearHint ? yearHint[1] : (new Date().getFullYear().toString());

        const cleanLines = preprocessed.map(tx =>
          `[${tx.idx}] ${tx.dateStr} | ${tx.type} | ${tx.amount.toFixed(2)} | ${tx.rawDescription}`
        ).join('\n');

        aiPromptText = `Statement year: ${year}\n\nTransactions to categorize (${preprocessed.length} total):\n${cleanLines}`;
      }

      // Call AI with full SYSTEM_PROMPT (handles both clean and raw formats)
      // 'preprocessor' (default): skip AI entirely, use JS rules for categories/payees.
      // 'deepseek'/'gemini': use AI even when preprocessor succeeds (user override).
      if (usePreprocessor && selectedProvider === 'preprocessor') {
        // Bypass AI: use empty transactions array so merge falls back to JS rules
        transactions = [];
        provider = 'preprocessor';
      } else if (usePreprocessor && (selectedProvider === 'deepseek' || selectedProvider === 'gemini')) {
        // User explicitly chose AI — call it for categorization on top of preprocessor amounts
        if (selectedProvider === 'deepseek') {
          const deepseekKey = env.DEEPSEEK_API_KEY;
          if (!deepseekKey) return Response.json({ error: 'DEEPSEEK_API_KEY not configured' }, { status: 500 });
          const result = await callDeepSeek(deepseekKey, aiPromptText);
          provider = 'deepseek';
          transactions = result.transactions;
        } else {
          if (!env.GEMINI_API_KEY) {
            return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
          }
          const result = await callGemini(env.GEMINI_API_KEY, aiPromptText);
          provider = 'gemini';
          transactions = result.transactions;
        }
      } else if (!usePreprocessor && (selectedProvider === 'deepseek' || selectedProvider === 'gemini')) {
        // Preprocessor failed, fall back to AI for full extraction
        if (selectedProvider === 'deepseek') {
          const deepseekKey = env.DEEPSEEK_API_KEY;
          if (!deepseekKey) return Response.json({ error: 'DEEPSEEK_API_KEY not configured' }, { status: 500 });
          const result = await callDeepSeek(deepseekKey, aiPromptText);
          provider = 'deepseek';
          transactions = result.transactions;
        } else {
          if (!env.GEMINI_API_KEY) {
            return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
          }
          const result = await callGemini(env.GEMINI_API_KEY, aiPromptText);
          provider = 'gemini';
          transactions = result.transactions;
        }
      } else {
        // Preprocessor failed and no AI selected — can't extract
        return Response.json({ error: 'Could not parse this statement. The Auto parser could not identify enough transactions. Try using DeepSeek or Gemini, or use Python pypdf for local extraction.' }, { status: 422 });
      }

      // Layer 2: Merge pre-processed amounts with AI categories/payees
      if (usePreprocessor) {
        transactions = mergePreprocessedWithAI(preprocessed, transactions, pdfText);
        corrections = []; // pre-processor already handles amount accuracy

        // SAFETY NET: filter out any transaction whose idx doesn't match the preprocessor.
        // This prevents AI-hallucinated transactions from leaking into the DB.
        const validIdx = new Set(preprocessed.map(tx => tx.idx));
        const before = transactions.length;
        transactions = transactions.filter(tx => validIdx.has(tx.idx));
        if (transactions.length < before) {
          console.warn(`[extract] Filtered out ${before - transactions.length} transactions with no matching preprocessor idx`);
        }
      } else {
        transactions.sort((a, b) => (a.idx || 0) - (b.idx || 0));
        corrections = validateAndCorrect(transactions, pdfText);
      }
    }

    // Insert into DB (no balance column)
    const insertStmt = env.DB.prepare(
      `INSERT INTO transactions (bank_statement_id, date, description, debit_amount, credit_amount, category, payee, particulars)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let insertedCount = 0;
    let skippedCredits = 0;
    for (const tx of transactions) {
      // Only insert debit transactions (payments) — skip credits/deposits
      if ((tx.debit_amount || 0) <= 0) {
        skippedCredits++;
        continue;
      }
      try {
        // Fallback particulars for non-CSV entries
        const txParticulars = tx.particulars || 'Payment';
        await insertStmt.bind(
          statement_id,
          tx.date,
          tx.description,
          tx.debit_amount || 0,
          0,
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
        skipped_credits: skippedCredits,
        corrections: corrections.length,
        correction_details: corrections,
        message: stmt.file_type === 'csv'
          ? `[System] Extracted ${insertedCount} debits (${skippedCredits} credits skipped)`
          : corrections.length > 0
            ? `[${provider}] Extracted ${insertedCount} debits · ${skippedCredits} credits skipped · Auto-corrected ${corrections.length} amount(s)`
            : `[${provider}] Extracted ${insertedCount} debits (${skippedCredits} credits skipped)`,
      });
    } else {
      return Response.json({
        success: true,
        provider,
        total_extracted: transactions.length,
        total_inserted: insertedCount,
        skipped_credits: skippedCredits,
        corrections: corrections.length,
        message: stmt.file_type === 'csv'
          ? `[System] Chunk ${chunk_index + 1}/${total_chunks} · ${insertedCount} debits`
          : `[${provider}] Chunk ${chunk_index + 1}/${total_chunks} · ${insertedCount} debits`,
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
