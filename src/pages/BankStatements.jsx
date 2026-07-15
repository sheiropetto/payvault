import { useState, useEffect, useRef } from 'react';
import {
  Upload, FileText, Trash2, AlertCircle, CheckCircle2,
  Clock, RefreshCw, FileSpreadsheet, Building2, XCircle
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
  const [statusMsg, setStatusMsg] = useState(null);
  const fileRef = useRef(null);

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
    try {
      await api.extractTransactions(stmt.id);
      await loadData();
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: 'error', text: 'Failed to extract: ' + err.message });
      setTimeout(() => setStatusMsg(null), 5000);
    } finally {
      setExtracting(null);
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
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Bank Statements</h1>
          <p className="text-sm text-zinc-500 mt-1">Upload PDF or CSV statements for AI extraction</p>
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
              ? <XCircle className="w-3.5 h-3.5" />
              : <CheckCircle2 className="w-3.5 h-3.5" />
            }
            {statusMsg.text}
          </div>
        )}
      </div>

      {/* Statements List */}
      {statements.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No statements yet"
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
                {statements.map((stmt) => {
                  const StatusIcon = statusIcons[stmt.status];
                  return (
                    <tr key={stmt.id}>
                      <td className="font-medium text-zinc-900">
                        <div className="flex items-center gap-2">
                          {stmt.file_type === 'pdf'
                            ? <FileText className="w-4 h-4 text-red-500" strokeWidth={1.5} />
                            : <FileSpreadsheet className="w-4 h-4 text-green-600" strokeWidth={1.5} />
                          }
                          <span className="truncate max-w-[200px]">{stmt.filename}</span>
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
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
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
