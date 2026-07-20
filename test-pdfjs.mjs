import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

// --- Copy of the deployed preprocessor ---
function preprocessPublicBankText(rawText) {
  const lines = rawText.split('\n');
  const txWithDate = /^(\d{2}\/\d{2})\s+(.*?)([\d,]+\.\d{2})\s*([\d,]+\.\d{2})\s*$/;
  const txNoDate = /^(.*?)([\d,]+\.\d{2})\s*([\d,]+\.\d{2})\s*$/;
  const TX_CODES = /\b(TSFR|DUITNOW|GIRO|DR-ECP|DEP-ECP|CHEQ|CHQ|LOAN|AUTOMATED|FPX|IBG|ATM|DEP-CASH|RMT|MISC|KUMPULAN|PERTUBUHAN|LEMBAGA|MAXIS)\b/i;
  const SKIP_LINE = /^(TEGASAN|RINGKASAN|Jumlah|Baki|This is a computer|No signature|PeeBee|Page \d|PENYATA|Nombor|Jenis|Tarikh|Muka|Dilindungi|Protected|Terima|Thank|Your banking|Anda boleh|You may|PERHATIAN|Dimaklumkan|Please be|sifar|tolerance|DATE TRANSACTION|TARIKH URUS|RAZ UTAMA|KL CITY|GRD FLOOR|BOX \d|TEL:|\. |Join the|Campaign|^\d+$)/i;

  const entries = [];
  let currentDate = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || SKIP_LINE.test(line)) continue;

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

    m = txNoDate.exec(line);
    if (m && currentDate) {
      let desc = (m[1] || '').trim();
      const amount = parseFloat(m[2].replace(/,/g, ''));
      const balance = parseFloat(m[3].replace(/,/g, ''));
      if (desc && desc.length >= 2) {
        if (/^Balance/i.test(desc)) continue;
        if (TX_CODES.test(desc)) {
          entries.push({ dateStr: currentDate, amount, balance, desc });
        } else if (entries.length > 0) {
          entries[entries.length - 1].desc += ' ' + desc;
        }
      }
      continue;
    }

    if (entries.length > 0 && line.length > 2 && !/^[\d,]+\.\d{2}/.test(line)) {
      entries[entries.length - 1].desc += ' ' + line;
    }
  }

  if (entries.length < 3) return null;

  const bflMatch = rawText.match(/Balance\s+From\s+Last\s+Statement\s+([\d,]+\.\d{2})/i);
  if (bflMatch) {
    entries.unshift({ dateStr: entries[0]?.dateStr || '01/01', amount: 0, balance: parseFloat(bflMatch[1].replace(/,/g, '')), desc: 'BALANCE_FROM_LAST_STATEMENT', _isReference: true });
  }

  const transactions = [];
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    if (cur._isReference) continue;
    const prev = entries[i - 1];
    const descUpper = cur.desc.toUpperCase();
    let type, txAmount;
    if (prev) {
      const delta = cur.balance - prev.balance;
      if (delta < -0.005) { type = 'DEBIT'; txAmount = Math.abs(delta); }
      else if (delta > 0.005) { type = 'CREDIT'; txAmount = delta; }
      else {
        if (/\b(CR|CDT|DEP[- ])/i.test(descUpper)) { type = 'CREDIT'; txAmount = cur.amount; }
        else if (/\b(DR|PYMT|FEE|FPX|GIRO|LOAN|TRSF)\b/i.test(descUpper)) { type = 'DEBIT'; txAmount = cur.amount; }
        else continue;
      }
    } else {
      type = /\b(CR|CDT|DEP[- ])/i.test(descUpper) ? 'CREDIT' : 'DEBIT';
      txAmount = cur.amount;
    }
    if (txAmount < 0.005) continue;
    transactions.push({ idx: transactions.length + 1, dateStr: cur.dateStr, type, amount: parseFloat(txAmount.toFixed(2)), rawDescription: cur.desc });
  }
  return transactions.length >= 3 ? transactions : null;
}

// --- Test ---
const data = new Uint8Array(fs.readFileSync('Sample/3226704211_2024-October.pdf'));
const pdf = await pdfjsLib.getDocument({ data }).promise;
const allPages = [];

for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  const items = [...content.items].sort((a, b) => {
    const ay = a.transform?.[5] || 0, by = b.transform?.[5] || 0;
    if (Math.abs(ay - by) > 2) return by - ay;
    return (a.transform?.[4] || 0) - (b.transform?.[4] || 0);
  });
  const lines = [];
  let cur = [], lastY = null;
  for (const item of items) {
    const y = item.transform ? Math.round(item.transform[5]) : 0;
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      if (cur.length) lines.push(cur.map(it => it.str).join(''));
      cur = [];
    }
    cur.push(item); lastY = y;
  }
  if (cur.length) lines.push(cur.map(it => it.str).join(''));
  allPages.push(lines.join('\n'));
}

const fullText = allPages.join('\n');
const result = preprocessPublicBankText(fullText);

if (!result) { console.log('PREPROCESSOR FAILED'); process.exit(1); }

let d=0, c=0, dc=0, cc=0;
for (const tx of result) {
  if (tx.type === 'DEBIT') { d += tx.amount; dc++; }
  else { c += tx.amount; cc++; }
}
console.log(`Transactions: ${result.length} | Debits: ${d.toFixed(2)} (${dc}) | Credits: ${c.toFixed(2)} (${cc})`);
console.log(`Expected: 92 debits, 2856013.52 | 17 credits, 2850861.01`);
console.log(`Match: ${dc===92 && Math.abs(d-2856013.52)<1 ? 'YES!' : 'NO'}`);

