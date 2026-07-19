import { useState, useEffect, useMemo } from 'react';
import { Search, Pencil, Check, X, Users, Square, CheckSquare, Merge } from 'lucide-react';
import { api } from '../utils/api';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';

export default function Payees() {
  const { selectedCompanyId } = useCompany();
  const [payees, setPayees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [mergeTarget, setMergeTarget] = useState(null);

  useEffect(() => {
    if (selectedCompanyId) loadPayees();
  }, [selectedCompanyId]);

  async function loadPayees() {
    setLoading(true);
    try {
      const data = await api.getPayees(selectedCompanyId);
      setPayees(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return payees;
    const lower = search.toLowerCase();
    return payees.filter(p => p.payee.toLowerCase().includes(lower));
  }, [payees, search]);

  const selectedList = useMemo(() => {
    return [...selected].sort();
  }, [selected]);

  function toggleSelect(payeeName) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(payeeName) ? next.delete(payeeName) : next.add(payeeName);
      return next;
    });
    setMergeTarget(null);
  }

  function toggleSelectAll() {
    setSelected(prev => {
      if (prev.size === filtered.length) return new Set();
      return new Set(filtered.map(p => p.payee));
    });
    setMergeTarget(null);
  }

  function startEdit(payee) {
    setEditingId(payee.payee);
    setEditValue(payee.payee);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  function handleRename(oldPayee) {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === oldPayee) {
      cancelEdit();
      return;
    }

    setConfirm({
      title: 'Rename Payee',
      message: `Update "${oldPayee}" to "${trimmed}" across ALL transactions? This will affect ${payees.find(p => p.payee === oldPayee)?.tx_count || 0} transaction(s) across all months.`,
      variant: 'default',
      confirmLabel: 'Rename',
      onConfirm: async () => {
        setSaving(true);
        setConfirm(null);
        try {
          const result = await api.renamePayee(oldPayee, trimmed);
          setStatus({ type: 'success', message: `${result.updated} transaction(s) updated.` });
          setEditingId(null);
          setEditValue('');
          await loadPayees();
          setTimeout(() => setStatus(null), 3000);
        } catch (err) {
          setStatus({ type: 'error', message: err.message });
        } finally {
          setSaving(false);
        }
      },
    });
  }

  function handleMerge() {
    if (selectedList.length < 2) return;

    const totalTxns = selectedList.reduce((sum, name) => {
      const p = payees.find(x => x.payee === name);
      return sum + (p?.tx_count || 0);
    }, 0);

    setConfirm({
      title: 'Merge Payees',
      message: `Merge ${selectedList.length - 1} payee(s) into "${mergeTarget}"? This will update ${totalTxns} transaction(s). The other payee names will disappear from this list.`,
      variant: 'default',
      confirmLabel: `Merge into "${mergeTarget}"`,
      onConfirm: async () => {
        setSaving(true);
        setConfirm(null);
        try {
          const result = await api.mergePayees(selectedList, mergeTarget);
          setStatus({ type: 'success', message: `${result.updated} transaction(s) merged.` });
          setSelected(new Set());
          setMergeTarget(null);
          await loadPayees();
          setTimeout(() => setStatus(null), 3000);
        } catch (err) {
          setStatus({ type: 'error', message: err.message });
        } finally {
          setSaving(false);
        }
      },
    });
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Payees</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage payee names across all transactions</p>
        </div>
      </div>

      {/* Status message */}
      {status && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 ${
          status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {status.message}
        </div>
      )}

      {/* Toolbar: Search + Merge */}
      {payees.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
              <input
                className="input pl-9"
                placeholder="Search payees..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {selectedList.length >= 2 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{selectedList.length} selected</span>
                {!mergeTarget ? (
                  <button
                    onClick={() => setMergeTarget(selectedList[0])}
                    className="btn-secondary flex items-center gap-1.5 text-xs h-8"
                  >
                    <Merge className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Merge Selected
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-zinc-400">into</span>
                    <select
                      className="text-xs border border-zinc-300 rounded-lg px-2 py-1 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                    >
                      {selectedList.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleMerge}
                      className="px-3 py-1 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 transition-colors"
                    >
                      Merge
                    </button>
                    <button
                      onClick={() => setMergeTarget(null)}
                      className="p-1 rounded-md text-zinc-400 hover:text-zinc-600"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payees list */}
      {payees.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8" strokeWidth={1.5} />}
          title="No payees yet"
          description="Payee names will appear here once you extract transactions from bank statements."
        />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12 text-zinc-500 text-sm">
          No payees match your search.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="w-10 px-3 py-3">
                    <button onClick={toggleSelectAll} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                      ) : (
                        <Square className="w-4 h-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3 w-full">
                    Payee Name
                  </th>
                  <th className="text-right text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    Transactions
                  </th>
                  <th className="text-right text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    Months
                  </th>
                  <th className="text-right text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((p) => {
                  const isEditing = editingId === p.payee;
                  const isSelected = selected.has(p.payee);
                  return (
                    <tr key={p.payee} className={`hover:bg-zinc-50 transition-colors ${isEditing ? 'bg-zinc-50' : ''} ${isSelected ? 'bg-zinc-50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <button onClick={() => toggleSelect(p.payee)} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                          ) : (
                            <Square className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <input
                            className="input py-1 px-2 text-sm w-full"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(p.payee);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            autoFocus
                            disabled={saving}
                          />
                        ) : (
                          <span className="text-sm text-zinc-800 font-medium">{p.payee}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm text-zinc-500 tabular-nums">{p.tx_count}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm text-zinc-500 tabular-nums">{p.stmt_count}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleRename(p.payee)}
                              disabled={saving || !editValue.trim() || editValue.trim() === p.payee}
                              className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Save"
                            >
                              <Check className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(p)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                            title="Rename payee"
                          >
                            <Pencil className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        variant={confirm?.variant || 'default'}
        confirmLabel={confirm?.confirmLabel || 'Confirm'}
        loading={saving}
        onConfirm={() => confirm?.onConfirm?.()}
        onCancel={() => { setConfirm(null); cancelEdit(); }}
      />
    </div>
  );
}
