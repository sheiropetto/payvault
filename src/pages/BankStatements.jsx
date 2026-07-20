import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, Trash2, AlertCircle, CheckCircle2,
  Clock, RefreshCw, FileSpreadsheet, Building2, XCircle, Zap,
  Download, Sparkles, Save, Pencil, Eye, CheckSquare, Square
} from 'lucide-react';
import { api } from '../utils/api';
import { formatDate } from '../utils/format';
import { extractTextFromPDF } from '../utils/pdfExtract';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Select from '../components/ui/Select';

const statusIcons = {
  pending: Clock,
  processing: RefreshCw,
  done: CheckCircle2,
  error: AlertCircle,
};

const statusColors = {
  pending: 'badge-pending',
  processing: 'badge-processing',
  done: 'badge-done',
  error: 'badge-error',
};

export default function BankStatements() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const navigate = useNavigate();
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [extracting, setExtracting] = useState(null);
  const [extractStep, setExtractStep] = useState(''); // 'download' | 'extract-text' | 'ai-call' | 'saving'
  const [extractProvider, setExtractProvider] = useState('preprocessor'); // 'preprocessor' | 'deepseek' | 'gemini' | 'pypdf'
  const [statusMsg, setStatusMsg] = useState(null);
  const [retryStmt, setRetryStmt] = useState(null); // { stmt }
  const [selectedYear, setSelectedYear] = useState('');
  const [editingId, setEditingId] = useState(null);   // inline rename
  const [editValue, setEditValue] = useState('');
  const [renamingAll, setRenamingAll] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const fileRef = useRef(null);
  const editRef = useRef(null);

  const allYears = [...new Set(statements.map(s => s.year).filter(Boolean))].sort((a, b) => b - a);

  useEffect(() => {
    if (allYears.length > 0 && !selectedYear) {
      setSelectedYear(String(allYears[0]));
    }
  }, [allYears]);

  const effectiveYear = selectedYear ? Number(selectedYear) : null;

  const filteredStatements = statements.filter(s => {
    if (!effectiveYear) return true;
    return s.year === effectiveYear || s.year === null;
  });



  useEffect(() => {
    if (selectedCompanyId) loadData();
  }, [selectedCompanyId]);

  async function loadData() {
    try {
      const stmtRes = await api.getStatements(selectedCompanyId);
      setStatements(stmtRes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(files) {
    if (!files.length || !selectedCompanyId) return;
    setUploading(true);
    setStatusMsg(null);
    try {
      for (const file of files) {
        await api.uploadStatement(file, selectedCompanyId);
      }
      setStatusMsg({ type: 'success', text: 'Upload successful!' });
      await loadData();
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: 'error', text: 'Upload failed: ' + err.message });
    } finally {
      setUploading(false);
      fileRef.current.value = '';
    }
  }

  async function handleExtract(stmt) {
    // Python pypdf: download the script for local use
    if (extractProvider === 'pypdf') {
      const PYTHON_SCRIPT = `import re
import pypdf
import pandas as pd

PURPOSE_KEYWORDS = [
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
]

purpose_pattern = re.compile(r'\\s+\\b(' + '|'.join(PURPOSE_KEYWORDS) + r')\\b.*', re.IGNORECASE)

def clean_extracted_name(name):
    name = re.sub(r'MYCN\\d+.*', '', name, flags=re.IGNORECASE)
    name = re.sub(r'DUITNOW\\s*\\(.*', '', name, flags=re.IGNORECASE)
    name = re.sub(r'Balance\\s+C/F.*', '', name, flags=re.IGNORECASE)
    name = purpose_pattern.sub('', name)
    name = re.sub(r'\\s+\\b(?=[A-Z]*\\d)(?=\\d*[A-Z])[A-Z0-9_-]{5,}\\b.*$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\\s+', ' ', name).strip()
    
    # Apply name mappings/corrections for truncated payees
    mappings = {
        'MUHAMMAD RAIMIEY BIN': 'MUHAMMAD RAIMIEY',
        'FARZIEYANA BINTI MOH': 'FARZIEYANA BINTI MOHD ARIFF',
        'SITI MARDIANASARI BI': 'SITI MARDIANASARI',
        'AILYN BINTI ABD.MAJI': 'AILYN BINTI ABD MAJID'
    }
    upper_name = name.upper()
    if upper_name in mappings:
        return mappings[upper_name]
        
    return name

def extract_payee(desc):
    if not desc:
        return ""
    du = desc.upper()
    known_entities = {
        'LEMBAGA HASIL DALAM NEGERI': 'LEMBAGA HASIL DALAM NEGERI',
        'KUMPULAN WANG SIMPANAN PEKERJA': 'KUMPULAN WANG SIMPANAN PEKERJA',
        'PERTUBUHAN KESELAMATAN SOSIAL': 'PERTUBUHAN KESELAMATAN SOSIAL',
        'LEMBAGA PEMBANGUNAN INDUSTRI': 'LEMBAGA PEMBANGUNAN INDUSTRI',
    }
    for key, val in known_entities.items():
        if key in du:
            return val
            
    if 'DR-ECP' in du:
        m = re.search(r'DR-ECP\\s+\\d+(?:\\s+\\d+)?\\s*(.*)', du)
        if m:
            return clean_extracted_name(m.group(1))
    if 'DEP-ECP' in du:
        m = re.search(r'DEP-ECP\\s+\\d+\\s*(.*)', du)
        if m:
            name = m.group(1)
            name = re.sub(r'^[A-Z0-9]{15,}\\s+', '', name)
            name = re.sub(r'^(RHB|MBB|PBB|CIMB)\\s+', '', name, flags=re.IGNORECASE)
            return clean_extracted_name(name)

    m = re.search(r'DUITNOW\\s+TRSF\\s+(?:DR|CR)\\s+(?:\\d{6}\\s+)?(.*)', du)
    if m:
        return clean_extracted_name(m.group(1))
        
    m = re.search(r'TSFR\\s+FUND\\s+(?:DR|CR)(?:-ATM/EFT)?\\s+\\d{6}\\s+(?:\\w*X{2,}\\w*\\s+)?(.*)', du)
    if m:
        name = m.group(1)
        name = re.sub(r'^(IBG|SCB|CGB|WARRANT|TRANSFER|EFT)\\s+', '', name, flags=re.IGNORECASE)
        return clean_extracted_name(name)
        
    m = re.search(r'GIRO\\s+PYMT-ATM/EFT\\s+\\d*\\s*(.*)', du)
    if m:
        name = m.group(1)
        if 'JOMPAY' in name:
            return ''
        return clean_extracted_name(name)

    if 'RMT CR' in du:
        return 'KENANGA INVESTMENT BANK BERHAD'
    if any(x in du for x in ['RMT DR', 'RMT CHRG']):
        return ''
    if 'AUTOMATED LOAN' in du:
        return ''
    if re.search(r'\\bCH(E)?Q(UE)?\\s+PROCESS\\s+FEE\\b', du):
        return ''
    if re.match(r'^CHEQ\\s+\\d+', du):
        return ''
    if 'MISC DR' in du:
        return ''
    if 'DEP-CASH' in du:
        return ''
    if 'FPX' in du:
        return ''

    cleaned = du
    prefixes = [
        r'\\b(TSFR|FUND|CR|DR|DUITNOW|TRSF|GIRO|PYMT|FPX|DEP-CASH|CDT|IBG|ATM|CASH)\\b',
        r'\\b(ATM-EFT|PROCESS|FEE|LEMBAGA|HASIL|DALAM|NEGERI)\\b',
        r'\\d{5,}',
        r'[^A-Z0-9\\s.\\-/&]'
    ]
    for pattern in prefixes:
        cleaned = re.sub(pattern, ' ', cleaned)
    return clean_extracted_name(cleaned)

def parse_public_bank_statement(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() + "\\n"
    lines = full_text.split('\\n')

    tx_with_date = re.compile(
        r'^(\\d{2}/\\d{2})\\s*([\\d,]+\\.\\d{2})\\s*([\\d,]+\\.\\d{2})\\s*(.*)$')
    tx_no_date = re.compile(
        r'^([\\d,]+\\.\\d{2})\\s*([\\d,]+\\.\\d{2})\\s*(.*)$')
    TX_CODES = re.compile(
        r'\\b(TSFR|DUITNOW|GIRO|DR-ECP|DEP-ECP|CHEQ|CHQ|LOAN|AUTOMATED|'
        r'FPX|IBG|ATM|DEP-CASH|RMT|MISC|KUMPULAN|PERTUBUHAN|LEMBAGA|MAXIS)\\b')

    SKIP = re.compile(r'^(TEGASAN|RINGKASAN|Jumlah|Baki|This is a computer|'
        r'No signature|PeeBee|Page \\\\d|PENYATA|Nombor|Jenis|Tarikh|Muka|'
        r'Dilindungi|Protected|Terima|Thank|Your banking|Anda boleh|You may|'
        r'PERHATIAN|Dimaklumkan|Please be|sifar|tolerance|DATE TRANSACTION|'
        r'TARIKH URUS|RAZ UTAMA|KL CITY|GRD FLOOR|BOX \\\\d|TEL:|Join the|'
        r'Campaign|^\\\\d+$)')

    entries = []
    current_date = None

    for line in lines:
        line = line.strip()
        if not line or SKIP.match(line):
            continue
        m = tx_with_date.match(line)
        if m:
            current_date = m.group(1)
            amount = float(m.group(2).replace(',', ''))
            balance = float(m.group(3).replace(',', ''))
            desc = m.group(4).strip()
            if desc and len(desc) >= 2 and TX_CODES.search(desc):
                entries.append({'date': current_date, 'amount': amount,
                               'balance': balance, 'desc': desc})
            continue
        m = tx_no_date.match(line)
        if m and current_date:
            amount = float(m.group(1).replace(',', ''))
            balance = float(m.group(2).replace(',', ''))
            desc = m.group(3).strip()
            if desc and len(desc) >= 2:
                if desc.startswith('Balance'):
                    continue
                if TX_CODES.search(desc):
                    entries.append({'date': current_date, 'amount': amount,
                                   'balance': balance, 'desc': desc})
                elif entries:
                    entries[-1]['desc'] += ' ' + desc
            continue
        if entries and len(line) > 2 and not re.match(r'^[\\d,]+\\.\\d{2}', line):
            entries[-1]['desc'] += ' ' + line

    if len(entries) < 3:
        raise ValueError("Could not find enough transactions")

    bfl = re.search(r'Balance\\s+From\\s+Last\\s+Statement\\s+([\\d,]+\\.\\d{2})',
                    full_text, re.IGNORECASE)
    if bfl:
        entries.insert(0, {'date': entries[0]['date'], 'amount': 0,
                          'balance': float(bfl.group(1).replace(',', '')), 
                          'desc': 'BALANCE_FROM_LAST_STATEMENT', '_ref': True})

    records = []
    prev_balance = None
    for e in entries:
        if e.get('_ref'):
            prev_balance = e['balance']
            continue
        if prev_balance is not None:
            delta = e['balance'] - prev_balance
            if delta < -0.005:
                dr, cr = abs(delta), 0.0
            elif delta > 0.005:
                dr, cr = 0.0, delta
            else:
                desc_up = e['desc'].upper()
                if any(kw in desc_up for kw in ['CR', 'CDT', 'DEP-']):
                    dr, cr = 0.0, e['amount']
                else:
                    dr, cr = e['amount'], 0.0
        else:
            desc_up = e['desc'].upper()
            if any(kw in desc_up for kw in ['CR', 'CDT', 'DEP-']):
                dr, cr = 0.0, e['amount']
            else:
                dr, cr = e['amount'], 0.0
        if dr + cr >= 0.005:
            records.append({'Date': e['date'], 'Description': e['desc'][:150],
                          'Payee': extract_payee(e['desc']),
                          'Withdrawal (DR)': round(dr, 2),
                          'Deposit (CR)': round(cr, 2),
                          'Balance': e['balance']})
        prev_balance = e['balance']

    df = pd.DataFrame(records)
    return df

if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print("Usage: python parse_pdf.py <pdf_file>")
        sys.exit(1)
    pdf_file = sys.argv[1]
    df = parse_public_bank_statement(pdf_file)
    csv_name = pdf_file.rsplit('.', 1)[0] + '_parsed.csv'
    df.to_csv(csv_name, index=False)
    dr = df['Withdrawal (DR)'].sum()
    cr = df['Deposit (CR)'].sum()
    print(f"Extracted {len(df)} transactions")
    print(f"Debits: {dr:,.2f} ({len(df[df['Withdrawal (DR)'] > 0])})")
    print(f"Credits: {cr:,.2f} ({len(df[df['Deposit (CR)'] > 0])})")
    print(f"Saved to: {csv_name}")
    print("Upload this CSV file to PayVault to import the transactions.")
`;
      const blob = new Blob([PYTHON_SCRIPT], { type: 'text/x-python' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'parse_pdf.py';
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ 
        type: 'success', 
        text: 'Python script downloaded! Run: python parse_pdf.py your_statement.pdf\nThen upload the generated CSV to PayVault.' 
      });
      return;
    }

    setExtracting(stmt.id);
    setExtractStep('download');
    setStatusMsg(null);
    setRetryStmt(null);
    try {
      if (stmt.file_type === 'pdf') {
        const blob = await api.downloadStatement(stmt.id);
        setExtractStep('extract-text');
        const pages = await extractTextFromPDF(blob);

        if (pages && pages.length > 0) {
          const totalTextLength = pages.reduce((sum, p) => sum + (p || '').trim().length, 0);
          if (totalTextLength === 0) {
            throw new Error('This PDF appears to be scanned or contains no selectable text. Please upload a structured (digital) PDF or a CSV file instead.');
          }
          let lastResult = null;
          // Preprocessor (Auto) needs all pages together for balance chain.
          // AI providers process page-by-page to stay within token limits.
          if (extractProvider === 'preprocessor') {
            setExtractStep('ai-call');
            const allText = pages.join('\n');
            lastResult = await api.extractTransactions(stmt.id, allText, 0, 1, extractProvider);
          } else {
            for (let i = 0; i < pages.length; i++) {
              setExtractStep(`ai-call-${i + 1}-of-${pages.length}`);
              const pageText = pages[i];
              lastResult = await api.extractTransactions(stmt.id, pageText, i, pages.length, extractProvider);
            }
          }
          setExtractStep('saving');
          if (lastResult) {
            setStatusMsg({ type: 'success', text: lastResult.message });
          }
        } else {
          throw new Error('No text found in PDF');
        }
      } else {
        setExtractStep('csv-extract');
        const result = await api.extractTransactions(stmt.id, '', undefined, undefined, extractProvider);
        setExtractStep('saving');
        setStatusMsg({ type: 'success', text: result.message });
      }
      await loadData();
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: 'error', text: stmt.file_type === 'pdf' ? `[${extractProvider === 'deepseek' ? 'DeepSeek' : extractProvider === 'gemini' ? 'Gemini' : 'Auto'}] ${err.message}` : `[System] ${err.message}` });
      setRetryStmt({ stmt });
    } finally {
      setExtracting(null);
      setExtractStep('');
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteStatement(id);
      await loadData();
      setConfirm(null);
    } catch (err) {
      console.error(err);
    }
  }

  function startEditing(stmt) {
    setEditingId(stmt.id);
    setEditValue(stmt.filename);
    setTimeout(() => editRef.current?.focus(), 50);
  }

  async function handleRename(id) {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === statements.find(s => s.id === id)?.filename) {
      setEditingId(null);
      return;
    }
    try {
      await api.renameStatement(id, trimmed);
      await loadData();
    } catch (err) {
      console.error(err);
    }
    setEditingId(null);
  }

  async function handleAutoRenameAll() {
    setRenamingAll(true);
    try {
      const result = await api.autoRenameStatements(selectedCompanyId);
      setStatusMsg({ type: 'success', text: `Renamed ${result.renamed} of ${result.total} statements.` });
      await loadData();
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Rename failed: ' + err.message });
    } finally {
      setRenamingAll(false);
    }
  }

  // Check if any statements could benefit from auto-rename
  const renameableCount = statements.filter(s => s.month && s.year).length;
  const hasRawNames = statements.some(s => {
    if (!s.month || !s.year) return false;
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const expected = `${months[s.month - 1]} ${s.year}`;
    return !s.filename.startsWith(expected);
  });

  // Count statements whose PDFs can be cleaned up (extracted + file still in R2)
  const cleanableCount = statements.filter(s => s.status === 'done' && s.file_url).length;

  async function handleCleanupPDFs() {
    setConfirm({
      title: 'Clean Up PDFs',
      message: `Delete ${cleanableCount} extracted PDF file(s) from storage? The extracted transaction data is kept — only the original PDF file is removed.`,
      variant: 'danger',
      confirmLabel: `Delete ${cleanableCount} PDFs`,
      onConfirm: async () => {
        try {
          const result = await api.cleanupPDFs(selectedCompanyId);
          setStatusMsg({ type: 'success', text: `Cleaned up ${result.deleted} PDF(s).` });
          await loadData();
          setConfirm(null);
          setTimeout(() => setStatusMsg(null), 5000);
        } catch (err) {
          setStatusMsg({ type: 'error', text: 'Cleanup failed: ' + err.message });
          setConfirm(null);
        }
      },
    });
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === filteredStatements.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredStatements.map(s => s.id)));
    }
  }

  async function handleBulkDelete() {
    setConfirm({
      title: 'Delete Statements',
      message: `Delete ${selected.size} statement(s) and all their transactions? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: `Delete ${selected.size}`,
      onConfirm: async () => {
        try {
          for (const id of selected) {
            await api.deleteStatement(id);
          }
          setSelected(new Set());
          await loadData();
          setConfirm(null);
          setStatusMsg({ type: 'success', text: `${selected.size} statement(s) deleted.` });
          setTimeout(() => setStatusMsg(null), 5000);
        } catch (err) {
          console.error(err);
          setStatusMsg({ type: 'error', text: 'Delete failed: ' + err.message });
        }
      },
    });
  }

  if (loading) return <LoadingSpinner />;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const coveredMonths = new Set();
  statements.forEach(s => {
    if (effectiveYear && s.year === effectiveYear && s.month) coveredMonths.add(s.month);
  });
  const coveragePct = effectiveYear ? Math.round((coveredMonths.size / 12) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Bank Statements</h1>
          <p className="text-sm text-zinc-500 mt-1">Upload PDF or CSV statements for AI extraction</p>
        </div>
        <div className="flex items-center gap-3">
          {/* AI Provider selector */}
          <div className="flex items-center gap-1.5 bg-zinc-100 rounded-lg p-0.5">
            <button
              onClick={() => setExtractProvider('preprocessor')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                extractProvider === 'preprocessor'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => setExtractProvider('deepseek')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                extractProvider === 'deepseek'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              DeepSeek
            </button>
            <button
              onClick={() => setExtractProvider('gemini')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                extractProvider === 'gemini'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Gemini
            </button>
            <button
              onClick={() => setExtractProvider('pypdf')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                extractProvider === 'pypdf'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Python pypdf
            </button>
          </div>

          {allYears.length >= 1 && (
            <div className="w-20">
              <Select
                value={selectedYear}
                onChange={setSelectedYear}
                options={allYears.map(y => ({ value: String(y), label: String(y) }))}
              />
            </div>
          )}

          {hasRawNames && (
            <button
              onClick={handleAutoRenameAll}
              disabled={renamingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-zinc-300 rounded-lg
                         text-zinc-600 hover:text-zinc-900 hover:border-zinc-400 transition-colors disabled:opacity-50"
            >
              <Pencil className="w-3 h-3" strokeWidth={1.5} />
              {renamingAll ? 'Renaming…' : `Rename ${renameableCount} files`}
            </button>
          )}
          {cleanableCount > 0 && (
            <button
              onClick={handleCleanupPDFs}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-zinc-300 rounded-lg
                         text-zinc-500 hover:text-red-600 hover:border-red-300 transition-colors"
            >
              <Trash2 className="w-3 h-3" strokeWidth={1.5} />
              Clean up {cleanableCount} PDF{cleanableCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Month Coverage */}
      {effectiveYear && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-zinc-700">{effectiveYear} Coverage</span>
            <span className="text-xs text-zinc-400">{coveredMonths.size}/12 months · {coveragePct}%</span>
          </div>
          <div className="grid grid-cols-12 gap-1.5">
            {MONTHS.map((m, i) => {
              const monthNum = i + 1;
              const has = coveredMonths.has(monthNum);
              return (
                <div
                  key={m}
                  className={`text-center py-2 rounded-md text-xs font-medium transition-colors ${has
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-400'
                    }`}
                  title={has ? `${m} ${effectiveYear} — statement uploaded` : `${m} ${effectiveYear} — no statement`}
                >
                  {m}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upload Area */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
          <span className="text-sm font-medium text-zinc-700">{selectedCompany?.name || 'No company'}</span>
        </div>
        <div>
          <label className="label">Upload File</label>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-zinc-300 rounded-xl p-6
                hover:border-zinc-900 cursor-pointer transition-colors text-center"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Upload className="w-6 h-6 text-zinc-400 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm text-zinc-600 font-medium">
              {uploading ? 'Uploading...' : 'Click to upload PDF or CSV'}
            </p>
            <p className="text-xs text-zinc-400 mt-1">Supports .pdf and .csv files</p>
          </div>
        </div>
        {statusMsg && (
          <div className={`mt-3 flex items-center gap-2 text-xs ${statusMsg.type === 'error' ? 'text-red-600' : 'text-green-600'
            }`}>
            {statusMsg.type === 'error'
              ? <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              : <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            }
            <span>{statusMsg.text}</span>
            {statusMsg.type === 'error' && retryStmt && (
              <button
                onClick={() => handleExtract(retryStmt.stmt)}
                className="ml-2 underline hover:no-underline font-medium"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {extracting && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                {extractStep === 'download' && <><Download className="w-3 h-3" strokeWidth={1.5} /> Downloading statement...</>}
                {extractStep === 'extract-text' && <><FileText className="w-3 h-3" strokeWidth={1.5} /> Reading PDF text...</>}
                {extractStep === 'csv-extract' && <><FileSpreadsheet className="w-3 h-3" strokeWidth={1.5} /> Parsing CSV...</>}
                {extractStep.startsWith('ai-call') && (
                  <><Sparkles className="w-3 h-3" strokeWidth={1.5} /> {
                    extractStep === 'ai-call'
                      ? `${extractProvider === 'deepseek' ? 'DeepSeek' : extractProvider === 'gemini' ? 'Gemini' : 'Auto'} is analyzing...`
                      : `${extractProvider === 'deepseek' ? 'DeepSeek' : extractProvider === 'gemini' ? 'Gemini' : 'Auto'} is analyzing page ${extractStep.replace('ai-call-', '').replace('-of-', ' of ')}...`
                  }</>
                )}
                {extractStep === 'saving' && <><Save className="w-3 h-3" strokeWidth={1.5} /> Saving transactions...</>}
              </span>
              <span>
                {extractStep === 'download' && '1/4'}
                {extractStep === 'extract-text' && '2/4'}
                {extractStep === 'csv-extract' && '3/4'}
                {extractStep.startsWith('ai-call') && '3/4'}
                {extractStep === 'saving' && '4/4'}
              </span>
            </div>
            <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-zinc-900 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: extractStep === 'download' ? '25%' :
                    extractStep === 'extract-text' ? '50%' :
                    extractStep === 'csv-extract' ? '75%' :
                      extractStep.startsWith('ai-call') ? '75%' : '100%'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Statements List */}
      {filteredStatements.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={effectiveYear ? `No statements for ${effectiveYear}` : 'No statements yet'}
          description="Upload a bank statement to get started with AI-powered transaction extraction."
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          {/* Selection toolbar */}
          {selected.size > 0 && (
            <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50 flex items-center gap-3">
              <span className="text-xs text-zinc-500">{selected.size} selected</span>
              <button
                className="btn-ghost text-xs text-red-500 hover:text-red-600 flex items-center gap-1.5"
                onClick={handleBulkDelete}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected
              </button>
              <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="sheet-grid">
              <thead>
                <tr>
                  <th className="w-10">
                    <button onClick={selectAll} className="p-1">
                      {selected.size === filteredStatements.length && filteredStatements.length > 0
                        ? <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                        : <Square className="w-4 h-4" strokeWidth={1.5} />
                      }
                    </button>
                  </th>
                  <th>Filename</th>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStatements.map((stmt) => {
                  const StatusIcon = statusIcons[stmt.status];
                  return (
                    <tr key={stmt.id} className={selected.has(stmt.id) ? 'bg-zinc-50' : ''}>
                      <td>
                        <button onClick={() => toggleSelect(stmt.id)} className="p-1">
                          {selected.has(stmt.id)
                            ? <CheckSquare className="w-4 h-4 text-zinc-900" strokeWidth={1.5} />
                            : <Square className="w-4 h-4 text-zinc-300" strokeWidth={1.5} />
                          }
                        </button>
                      </td>
                      <td className="font-medium text-zinc-900">
                        <div className="flex items-center gap-2">
                          {stmt.file_type === 'pdf'
                            ? <FileText className="w-4 h-4 text-red-500 flex-shrink-0" strokeWidth={1.5} />
                            : <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" strokeWidth={1.5} />
                          }
                          {editingId === stmt.id ? (
                            <input
                              ref={editRef}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => handleRename(stmt.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRename(stmt.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              className="w-full max-w-[400px] px-2 py-0.5 text-sm border border-zinc-300 rounded focus:outline-none focus:border-zinc-900"
                            />
                          ) : (
                            <span
                              className="truncate max-w-[400px] cursor-pointer hover:text-zinc-500 transition-colors"
                              title={stmt.filename + ' — click to rename'}
                              onClick={() => startEditing(stmt)}
                            >
                              {stmt.filename}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-zinc-600">{stmt.company_name}</td>
                      <td>
                        <span className="text-xs uppercase font-medium text-zinc-500">{stmt.file_type}</span>
                      </td>
                      <td className="text-zinc-600">{formatDate(stmt.uploaded_at)}</td>
                      <td>
                        <span className={statusColors[stmt.status]}>
                          <StatusIcon className="w-3 h-3 inline mr-1" strokeWidth={2} />
                          {stmt.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="btn-ghost text-xs px-2 py-1"
                            title="View PDF"
                            onClick={() => window.open(`/api/bank-statements/${stmt.id}?view=true`, '_blank')}
                          >
                            <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                          {stmt.status === 'done' && (
                            <button
                              className="btn-ghost text-xs px-2 py-1"
                              title="View transactions"
                              onClick={() => navigate(`/transactions?statement_id=${stmt.id}`)}
                            >
                              <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                            </button>
                          )}
                          {stmt.status === 'pending' && (
                            <button
                              className="btn-ghost text-xs px-2 py-1"
                              onClick={() => handleExtract(stmt)}
                              disabled={extracting === stmt.id}
                            >
                              {extracting === stmt.id ? (
                                <span className="flex items-center gap-1.5">
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  {extractStep === 'download' && 'Downloading...'}
                                  {extractStep === 'extract-text' && 'Reading PDF...'}
                                  {extractStep === 'ai-call' && 'AI extracting...'}
                                  {extractStep === 'saving' && 'Saving...'}
                                </span>
                              ) : (
                                'Extract'
                              )}
                            </button>
                          )}
                          <button
                            className="btn-ghost text-xs px-2 py-1 text-red-500 hover:text-red-600"
                            onClick={() => setConfirm({
                              title: 'Delete Statement',
                              message: `Delete "${stmt.filename}" and all its transactions?`,
                              variant: 'danger',
                              confirmLabel: 'Delete',
                              onConfirm: () => handleDelete(stmt.id),
                            })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        {...confirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
