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
  const [extractProvider, setExtractProvider] = useState('deepseek'); // 'deepseek' | 'gemini'
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
          for (let i = 0; i < pages.length; i++) {
            setExtractStep(`ai-call-${i + 1}-of-${pages.length}`);
            const pageText = pages[i];
            lastResult = await api.extractTransactions(stmt.id, pageText, i, pages.length, extractProvider);
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
      setStatusMsg({ type: 'error', text: stmt.file_type === 'pdf' ? `[${extractProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'}] ${err.message}` : `[System] ${err.message}` });
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
              onClick={() => setExtractProvider('deepseek')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                extractProvider === 'deepseek'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              DeepSeek
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
                      ? `${extractProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'} is analyzing...`
                      : `${extractProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'} is analyzing page ${extractStep.replace('ai-call-', '').replace('-of-', ' of ')}...`
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
