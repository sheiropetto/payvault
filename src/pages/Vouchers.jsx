import { useState, useEffect, useRef } from 'react';
import {
  FileText, Plus, Trash2, Printer, CheckSquare,
  Square, Search, Eye
} from 'lucide-react';
import { api } from '../utils/api';
import { formatCurrency, formatDate, generateVoucherHTML } from '../utils/format';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';

export default function Vouchers() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const [vouchers, setVouchers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [previewVoucher, setPreviewVoucher] = useState(null);
  const printRef = useRef(null);

  useEffect(() => { if (selectedCompanyId) loadData(); }, [selectedCompanyId]);

  async function loadData() {
    try {
      const [v, t] = await Promise.all([
        api.getVouchers(selectedCompanyId),
        api.getTemplates(selectedCompanyId),
      ]);
      setVouchers(v);
      setTemplates(t);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(v => v.id)));
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteVoucher(id);
      await loadData();
      setConfirm(null);
    } catch (err) {
      console.error(err);
    }
  }

  function handlePrint(id) {
    const v = vouchers.find(x => x.id === id);
    if (!v) return;
    const html = generateVoucherHTML(v, selectedCompany || {}, templateFor(v) || {});
    printHTML(html);
  }

  function templateFor(v) {
    return templates.find(t => t.id === v.template_id);
  }

  function handlePrintSelected() {
    const selectedVouchers = vouchers.filter(v => selected.has(v.id));
    if (!selectedVouchers.length) return;
    const pages = selectedVouchers.map(v => {
      return `<div class="voucher-page">${generateVoucherHTML(v, selectedCompany || {}, templateFor(v) || {})}</div>`;
    }).join('');
    printHTML(pages);
  }

  function printHTML(html) {
    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Voucher</title>
        <style>
          @page { margin: 15mm; }
          body { font-family: 'Inter', system-ui, sans-serif; }
          .voucher-page { page-break-after: always; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        ${html}
        <div class="no-print" style="text-align:center;padding:20px;">
          <button onclick="window.print()" style="padding:10px 30px;font-size:16px;cursor:pointer;">
            Print / Save PDF
          </button>
        </div>
      </body>
      </html>
    `);
    win.document.close();
  }

  function handlePreview(id) {
    const v = vouchers.find(x => x.id === id);
    if (!v) return;
    setPreviewVoucher({ voucher: v, company: selectedCompany, template: templateFor(v) });
  }

  const filtered = vouchers.filter(v =>
    !search || v.payee?.toLowerCase().includes(search.toLowerCase()) ||
    v.voucher_number?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Payment Vouchers</h1>
          <p className="text-sm text-zinc-500 mt-1">Generate, view, and print payment vouchers</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Voucher
        </button>
      </div>

      {/* Toolbar */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
            <input
              className="input pl-9"
              placeholder="Search by payee or voucher number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{selected.size} selected</span>
              <button className="btn-secondary text-xs" onClick={handlePrintSelected}>
                <Printer className="w-3.5 h-3.5" /> Print Bundle ({selected.size})
              </button>
              <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Vouchers List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No vouchers yet"
          description="Generate payment vouchers from your processed transactions."
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> Create Voucher
            </button>
          }
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="sheet-grid">
              <thead>
                <tr>
                  <th className="w-10">
                    <button onClick={selectAll} className="p-1">
                      {selected.size === filtered.length
                        ? <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                        : <Square className="w-4 h-4" strokeWidth={1.5} />
                      }
                    </button>
                  </th>
                  <th>Voucher No.</th>
                  <th>Payee</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id} className={selected.has(v.id) ? 'bg-zinc-50' : ''}>
                    <td>
                      <button onClick={() => toggleSelect(v.id)} className="p-1">
                        {selected.has(v.id)
                          ? <CheckSquare className="w-4 h-4 text-zinc-900" strokeWidth={1.5} />
                          : <Square className="w-4 h-4 text-zinc-300" strokeWidth={1.5} />
                        }
                      </button>
                    </td>
                    <td className="font-mono text-xs font-medium text-zinc-900">{v.voucher_number}</td>
                    <td className="font-medium text-zinc-900">{v.payee}</td>
                    <td className="text-zinc-600 text-xs">{formatDate(v.date)}</td>
                    <td><span className="text-xs text-zinc-500">{v.category || '-'}</span></td>
                    <td className="text-right font-semibold text-zinc-900">{formatCurrency(v.amount)}</td>
                    <td><span className={`badge-${v.status}`}>{v.status}</span></td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="btn-ghost p-1.5" title="Preview" onClick={() => handlePreview(v.id)}>
                          <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        <button className="btn-ghost p-1.5" title="Print" onClick={() => handlePrint(v.id)}>
                          <Printer className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          className="btn-ghost p-1.5 text-red-500 hover:text-red-600"
                          title="Delete"
                          onClick={() => setConfirm({
                            title: 'Delete Voucher',
                            message: `Delete voucher ${v.voucher_number}?`,
                            variant: 'danger',
                            confirmLabel: 'Delete',
                            onConfirm: () => handleDelete(v.id),
                          })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-zinc-100 text-xs text-zinc-400">
            {filtered.length} voucher{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewVoucher && (
        <div className="modal-overlay" onClick={() => setPreviewVoucher(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">Voucher Preview</h2>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs"
                  onClick={() => handlePrint(previewVoucher.voucher.id)}>
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button className="btn-ghost text-xs"
                  onClick={() => setPreviewVoucher(null)}>
                  Close
                </button>
              </div>
            </div>
            <div
              ref={printRef}
              dangerouslySetInnerHTML={{
                __html: generateVoucherHTML(
                  previewVoucher.voucher,
                  previewVoucher.company || {},
                  previewVoucher.template || {}
                )
              }}
            />
          </div>
        </div>
      )}

      {/* Create Voucher Modal */}
      {showCreate && (
        <CreateVoucherModal
          companyId={selectedCompanyId}
          companyName={selectedCompany?.name}
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData(); }}
        />
      )}

      <ConfirmModal
        open={!!confirm}
        {...confirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function CreateVoucherModal({ companyId, companyName, templates, onClose, onCreated }) {
  const [form, setForm] = useState({
    company_id: companyId || '',
    template_id: templates[0]?.id || '',
    payee: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
    invoice_ref: '',
    category: '',
    payment_method: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.payee || !form.amount) {
      setError('Payee and amount are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createVoucher({
        ...form,
        amount: parseFloat(form.amount),
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">New Payment Voucher</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Company</label>
              <input className="input" value={companyName || ''} disabled />
            </div>
            <div>
              <label className="label">Template</label>
              <select className="input" value={form.template_id}
                onChange={e => setForm(f => ({ ...f, template_id: e.target.value }))}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Payee</label>
            <input className="input" value={form.payee}
              onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Amount (RM)</label>
              <input className="input" type="number" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Invoice Reference</label>
              <input className="input" value={form.invoice_ref}
                onChange={e => setForm(f => ({ ...f, invoice_ref: e.target.value }))} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">Select...</option>
                {['Payment', 'Credit/Deposit', 'Fund Transfer', 'Bank Fee', 'Interest', 'Other'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Payment Method</label>
            <select className="input" value={form.payment_method}
              onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
              <option value="">Select...</option>
              {['Bank Transfer', 'Cheque', 'Cash', 'Online Banking', 'Card'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Create Voucher'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
