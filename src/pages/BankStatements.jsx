import { useState, useEffect, useRef } from 'react';
import {
  Upload, FileText, Trash2, AlertCircle, CheckCircle2,
  Clock, RefreshCw, FileSpreadsheet, Building2, XCircle, Zap,
  Download, Sparkles, Save
} from 'lucide-react';
import { api } from '../utils/api';
import { formatDate } from '../utils/format';
import { extractTextFromPDF } from '../utils/pdfExtract';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';

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
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [extracting, setExtracting] = useState(null);
  const [extractStep, setExtractStep] = useState(''); // 'download' | 'extract-text' | 'ai-call' | 'saving'
  const [statusMsg, setStatusMsg] = useState(null);
  const [provider, setProvider] = useState(() => localStorage.getItem('payvault-extract-provider') || 'deepseek');
  const [retryStmt, setRetryStmt] = useState(null); // { stmt, failedProvider }
  const [selectedYear, setSelectedYear] = useState('latest');
  const fileRef = useRef(null);

  const allYears = [...new Set(statements.map(s => s.year).filter(Boolean))].sort((a, b) => b - a);
  const latestYear = allYears[0];
  const effectiveYear = selectedYear === 'latest' ? latestYear : Number(selectedYear);

  const filteredStatements = statements.filter(s => {
    if (!effectiveYear) return true;
    return s.year === effectiveYear;
  });

  useEffect(() => {
    localStorage.setItem('payvault-extract-provider', provider);
  }, [provider]);

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

  async function handleExtract(stmt, overrideProvider = null) {
    const useProvider = overrideProvider || provider;
    setExtracting(stmt.id);
    setExtractStep('download');
    setStatusMsg(null);
    setRetryStmt(null);
    try {
      let text = '';

      // For PDFs: extract text client-side using pdfjs (better than server extraction)
      if (stmt.file_type === 'pdf') {
        const blob = await api.downloadStatement(stmt.id);
        setExtractStep('extract-text');
        text = await extractTextFromPDF(blob);
      }

      setExtractStep('ai-call');
      const result = await api.extractTransactions(stmt.id, text, useProvider);
      setExtractStep('saving');
      setStatusMsg({ type: 'success', text: `[${result.provider || useProvider}] ${result.message}` });
      await loadData();
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err) {
      console.error(err);
      const otherProvider = useProvider === 'deepseek' ? 'Gemini' : 'DeepSeek';
      setStatusMsg({ type: 'error', text: `[${useProvider}] ${err.message}` });
      setRetryStmt({ stmt, failedProvider: useProvider });
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

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Bank Statements</h1>
            <p className="text-sm text-zinc-500 mt-1">Upload PDF or CSV statements for AI extraction</p>
          </div>
          {allYears.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Year:</span>
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(e.target.value)}
                className="text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-600 focus:outline-none focus:border-zinc-400"
              >
                <option value="latest">Latest ({latestYear})</option>
                {allYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">Extract with:</span>
          <div className="flex border border-zinc-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setProvider('deepseek')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                provider === 'deepseek'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              <Zap className="w-3 h-3" strokeWidth={1.5} />
              DeepSeek
            </button>
            <button
              onClick={() => setProvider('gemini')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                provider === 'gemini'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              Gemini
            </button>
          </div>
        </div>
      </div>

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
          <div className={`mt-3 flex items-center gap-2 text-xs ${
            statusMsg.type === 'error' ? 'text-red-600' : 'text-green-600'
          }`}>
            {statusMsg.type === 'error'
              ? <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              : <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            }
            <span>{statusMsg.text}</span>
            {statusMsg.type === 'error' && retryStmt && (
              <button
                onClick={() => {
                  const other = retryStmt.failedProvider === 'deepseek' ? 'gemini' : 'deepseek';
                  handleExtract(retryStmt.stmt, other);
                }}
                className="ml-2 underline hover:no-underline font-medium"
              >
                Retry with {retryStmt.failedProvider === 'deepseek' ? 'Gemini' : 'DeepSeek'}
              </button>
            )}
          </div>
        )}
        {extracting && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                {extractStep === 'download' && <><Download className="w-3 h-3" strokeWidth={1.5} /> Downloading PDF...</>}
                {extractStep === 'extract-text' && <><FileText className="w-3 h-3" strokeWidth={1.5} /> Reading PDF text...</>}
                {extractStep === 'ai-call' && <><Sparkles className="w-3 h-3" strokeWidth={1.5} /> {provider === 'gemini' ? 'Gemini' : 'DeepSeek'} is analyzing...</>}
                {extractStep === 'saving' && <><Save className="w-3 h-3" strokeWidth={1.5} /> Saving transactions...</>}
              </span>
              <span>
                {extractStep === 'download' && '1/4'}
                {extractStep === 'extract-text' && '2/4'}
                {extractStep === 'ai-call' && '3/4'}
                {extractStep === 'saving' && '4/4'}
              </span>
            </div>
            <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-zinc-900 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: extractStep === 'download' ? '25%' :
                         extractStep === 'extract-text' ? '50%' :
                         extractStep === 'ai-call' ? '75%' : '100%'
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
          <div className="overflow-x-auto">
            <table className="sheet-grid">
              <thead>
                <tr>
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
                    <tr key={stmt.id}>
                      <td className="font-medium text-zinc-900">
                        <div className="flex items-center gap-2">
                          {stmt.file_type === 'pdf'
                            ? <FileText className="w-4 h-4 text-red-500" strokeWidth={1.5} />
                            : <FileSpreadsheet className="w-4 h-4 text-green-600" strokeWidth={1.5} />
                          }
                          <span className="truncate max-w-[450px]" title={stmt.filename}>{stmt.filename}</span>
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
