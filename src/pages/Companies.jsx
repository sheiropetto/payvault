import { useState, useEffect } from 'react';
import {
  Building2, Plus, Pencil, Trash2, Check, X, Phone, Mail
} from 'lucide-react';
import { api } from '../utils/api';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const printFields = [
  { key: 'show_logo', label: 'Logo' },
  { key: 'show_address', label: 'Address' },
  { key: 'show_phone', label: 'Phone' },
  { key: 'show_email', label: 'Email' },
  { key: 'show_tax_id', label: 'Tax ID' },
  { key: 'show_bank_details', label: 'Bank Details' },
  { key: 'show_signature', label: 'Signature' },
];

export default function Companies() {
  const { refreshCompanies } = useCompany();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { loadCompanies(); }, []);

  async function loadCompanies() {
    try {
      const data = await api.getCompanies();
      setCompanies(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(form) {
    try {
      if (form.id) {
        await api.updateCompany(form.id, form);
      } else {
        await api.createCompany(form);
      }
      await loadCompanies();
      await refreshCompanies();
      setEditModal(null);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteCompany(id);
      await loadCompanies();
      await refreshCompanies();
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
          <h1 className="text-lg font-semibold text-zinc-900">Companies</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage your company profiles and voucher preferences</p>
        </div>
        <button className="btn-primary" onClick={() => setEditModal({})}>
          <Plus className="w-4 h-4" /> Add Company
        </button>
      </div>

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="Add your first company profile to start generating payment vouchers."
          action={
            <button className="btn-primary" onClick={() => setEditModal({})}>
              <Plus className="w-4 h-4" /> Add Company
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {companies.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">{c.name}</h3>
                  {c.tax_id && <p className="text-xs text-zinc-500">Tax ID: {c.tax_id}</p>}
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost p-1.5" onClick={() => setEditModal(c)}>
                    <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                  </button>
                  <button className="btn-ghost p-1.5 text-red-500 hover:text-red-600"
                    onClick={() => setConfirm({
                      title: 'Delete Company',
                      message: `Delete "${c.name}" and all associated data?`,
                      variant: 'danger',
                      confirmLabel: 'Delete',
                      onConfirm: () => handleDelete(c.id),
                    })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-zinc-600 mb-4">
                {c.address && <p>{c.address}</p>}
                <div className="flex gap-4">
                  {c.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" strokeWidth={1.5} />{c.phone}</span>}
                  {c.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" strokeWidth={1.5} />{c.email}</span>}
                </div>
                {c.bank_name && c.bank_account && (
                  <p className="text-zinc-500 flex items-center gap-1"><Building2 className="w-3.5 h-3.5" strokeWidth={1.5} />{c.bank_name} — {c.bank_account}</p>
                )}
              </div>

              {/* Print visibility toggles */}
              <div className="border-t border-zinc-100 pt-3">
                <p className="text-xs font-medium text-zinc-500 mb-2">Show on voucher:</p>
                <div className="flex flex-wrap gap-2">
                  {printFields.map(f => (
                    <span key={f.key}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                        c[f.key] ? 'bg-zinc-100 text-zinc-700' : 'bg-zinc-50 text-zinc-400'
                      }`}>
                      {c[f.key] ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>

              {c.signature_name && (
                <div className="border-t border-zinc-100 pt-3 mt-3 text-xs text-zinc-500">
                  Signature: {c.signature_name}{c.signature_title ? ` (${c.signature_title})` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editModal && (
        <CompanyFormModal
          company={editModal}
          onSave={handleSave}
          onClose={() => setEditModal(null)}
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

function CompanyFormModal({ company, onSave, onClose }) {
  const [form, setForm] = useState({
    name: company.name || '',
    address: company.address || '',
    phone: company.phone || '',
    email: company.email || '',
    tax_id: company.tax_id || '',
    bank_name: company.bank_name || '',
    bank_account: company.bank_account || '',
    signature_name: company.signature_name || '',
    signature_title: company.signature_title || '',
    show_logo: company.show_logo ?? 1,
    show_address: company.show_address ?? 1,
    show_phone: company.show_phone ?? 0,
    show_email: company.show_email ?? 0,
    show_tax_id: company.show_tax_id ?? 1,
    show_bank_details: company.show_bank_details ?? 1,
    show_signature: company.show_signature ?? 1,
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave({ ...form, id: company.id });
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">
          {company.id ? 'Edit Company' : 'Add Company'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Company Name *</label>
              <input className="input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="col-span-2">
              <label className="label">Address</label>
              <textarea className="input" rows={2} value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tax ID / Registration No.</label>
              <input className="input" value={form.tax_id}
                onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} />
            </div>
            <div />
            <div>
              <label className="label">Bank Name</label>
              <input className="input" value={form.bank_name}
                onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Bank Account No.</label>
              <input className="input" value={form.bank_account}
                onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} />
            </div>
            <div>
              <label className="label">Signatory Name</label>
              <input className="input" value={form.signature_name}
                onChange={e => setForm(f => ({ ...f, signature_name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Signatory Title</label>
              <input className="input" value={form.signature_title}
                onChange={e => setForm(f => ({ ...f, signature_title: e.target.value }))} />
            </div>
          </div>

          {/* Print visibility */}
          <div>
            <p className="text-sm font-medium text-zinc-700 mb-2">Show on printed voucher:</p>
            <div className="flex flex-wrap gap-3">
              {printFields.map(f => (
                <label key={f.key} className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
                  <input type="checkbox"
                    checked={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.checked ? 1 : 0 }))}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : company.id ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
