import { useState, useEffect, useMemo } from 'react';
import { Search, Pencil, Check, X, Users, Square, CheckSquare, Merge, Sparkles, Circle } from 'lucide-react';
import { api } from '../utils/api';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Select from '../components/ui/Select';

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

  // Batch duplicate groups: { variants: string[], selected: string }
  const [duplicateGroups, setDuplicateGroups] = useState(null);

  // Bulk edit mode: edits all names at once
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkEdits, setBulkEdits] = useState({});

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

  function handleFindDuplicates() {
    function normalize(name) {
      return name.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Group by normalized form
    const normMap = new Map();
    for (const p of payees) {
      const norm = normalize(p.payee);
      if (!normMap.has(norm)) normMap.set(norm, []);
      normMap.get(norm).push(p.payee);
    }

    // Build raw groups
    const rawGroups = [];

    // Step 1: exact normalization matches (e.g., dot differences)
    for (const [, group] of normMap) {
      if (group.length >= 2) rawGroups.push([...group]);
    }

    // Step 2: substring matches (e.g., truncation)
    const norms = [...normMap.keys()];
    for (let i = 0; i < norms.length; i++) {
      for (let j = i + 1; j < norms.length; j++) {
        const longer = norms[i].length > norms[j].length ? norms[i] : norms[j];
        const shorter = norms[i].length > norms[j].length ? norms[j] : norms[i];
        if (shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.6) {
          const all = [...new Set([...normMap.get(norms[i]), ...normMap.get(norms[j])])];
          if (all.length >= 2) rawGroups.push(all);
        }
      }
    }

    // Deduplicate: each name in only one group, largest groups first
    const used = new Set();
    const finalGroups = [];
    rawGroups.sort((a, b) => b.length - a.length);
    for (const g of rawGroups) {
      const fresh = g.filter(n => !used.has(n));
      if (fresh.length >= 2) {
        // Pick the variant with most transactions as default selection
        const withCounts = fresh.map(name => {
          const p = payees.find(x => x.payee === name);
          return { name, txCount: p?.tx_count || 0, stmtCount: p?.stmt_count || 0 };
        });
        withCounts.sort((a, b) => b.txCount - a.txCount);
        finalGroups.push({
          variants: withCounts,
          selected: withCounts[0].name, // default: highest tx count
        });
        fresh.forEach(n => used.add(n));
      }
    }

    if (finalGroups.length === 0) {
      setStatus({ type: 'success', message: 'No duplicates found.' });
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    setDuplicateGroups(finalGroups);
    setSelected(new Set());
    setMergeTarget(null);

    const totalDupes = finalGroups.reduce((s, g) => s + g.variants.length - 1, 0);
    setStatus({ type: 'success', message: `Found ${finalGroups.length} duplicate group(s) with ${totalDupes} redundant names. Pick the canonical name for each and save.` });
  }

  function handleGroupSelect(groupIndex, selectedName) {
    setDuplicateGroups(prev => {
      const next = [...prev];
      next[groupIndex] = { ...next[groupIndex], selected: selectedName };
      return next;
    });
  }

  function handleClearDuplicates() {
    setDuplicateGroups(null);
    setStatus(null);
  }

  async function handleBatchMerge() {
    if (!duplicateGroups) return;

    const merges = duplicateGroups
      .map(g => ({
        from: g.variants.map(v => v.name),
        to: g.selected,
      }))
      .filter(m => m.from.length >= 2);

    if (merges.length === 0) return;

    const totalAffected = merges.reduce((s, m) => {
      const others = m.from.filter(n => n !== m.to);
      return s + others.reduce((sum, name) => {
        const p = payees.find(x => x.payee === name);
        return sum + (p?.tx_count || 0);
      }, 0);
    }, 0);

    setConfirm({
      title: 'Merge All Duplicates',
      message: `Merge ${merges.reduce((s, m) => s + m.from.length - 1, 0)} redundant payee names across ${merges.length} groups? This will update ${totalAffected} transaction(s).`,
      variant: 'default',
      confirmLabel: `Save All (${merges.length} groups)`,
      onConfirm: async () => {
        setSaving(true);
        setConfirm(null);
        try {
          const result = await api.batchMergePayees(merges);
          setStatus({ type: 'success', message: `${result.totalUpdated} transaction(s) updated across ${result.merges.length} groups.` });
          setDuplicateGroups(null);
          await loadPayees();
          setTimeout(() => setStatus(null), 4000);
        } catch (err) {
          setStatus({ type: 'error', message: err.message });
        } finally {
          setSaving(false);
        }
      },
    });
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

  // ─── Bulk edit ───
  function enterBulkEdit() {
    setBulkEditMode(true);
    setBulkEdits({});
    setEditingId(null);
  }

  function cancelBulkEdit() {
    setBulkEditMode(false);
    setBulkEdits({});
  }

  function handleBulkChange(payeeName, value) {
    setBulkEdits(prev => ({ ...prev, [payeeName]: value }));
  }

  async function handleBulkSave() {
    const changes = Object.entries(bulkEdits).filter(([oldName, newName]) =>
      newName.trim() && newName.trim() !== oldName
    );
    if (changes.length === 0) { cancelBulkEdit(); return; }

    setConfirm({
      title: 'Save Name Changes',
      message: `Update ${changes.length} payee name(s)? This will affect all associated transactions.`,
      variant: 'default',
      confirmLabel: `Save ${changes.length} change(s)`,
      onConfirm: async () => {
        setSaving(true);
        setConfirm(null);
        try {
          let total = 0;
          for (const [oldName, newName] of changes) {
            const result = await api.renamePayee(oldName, newName.trim());
            total += result.updated;
          }
          setStatus({ type: 'success', message: `${total} transaction(s) updated across ${changes.length} payees.` });
          cancelBulkEdit();
          await loadPayees();
          setTimeout(() => setStatus(null), 4000);
        } catch (err) {
          setStatus({ type: 'error', message: err.message });
        } finally {
          setSaving(false);
        }
      },
    });
  }

  const bulkEditCount = Object.values(bulkEdits).filter(v => v && v.trim()).length;

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

      {/* Duplicate groups — batch merge UI */}
      {duplicateGroups && duplicateGroups.length > 0 && (
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">
              {duplicateGroups.length} duplicate group{duplicateGroups.length > 1 ? 's' : ''} found
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearDuplicates}
                className="border border-zinc-300 bg-transparent text-zinc-500 rounded-lg px-3 py-1.5 text-xs hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchMerge}
                disabled={saving}
                className="bg-zinc-800 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : `Save All (${duplicateGroups.length} groups)`}
              </button>
            </div>
          </div>

          {duplicateGroups.map((group, gi) => (
            <div key={gi} className="card border border-zinc-200">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Group {gi + 1}</span>
                <span className="text-xs text-zinc-400">·</span>
                <span className="text-xs text-zinc-400">{group.variants.length} variants</span>
              </div>
              <div className="space-y-1.5">
                {group.variants.map((v) => {
                  const isSelected = group.selected === v.name;
                  return (
                    <button
                      key={v.name}
                      onClick={() => handleGroupSelect(gi, v.name)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        isSelected
                          ? 'bg-zinc-100 border border-zinc-300'
                          : 'border border-transparent hover:bg-zinc-50'
                      }`}
                    >
                      <Circle
                        className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-zinc-700 fill-zinc-700' : 'text-zinc-300'}`}
                        strokeWidth={1.5}
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${isSelected ? 'text-zinc-900 font-medium' : 'text-zinc-600'}`}>
                          {v.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-zinc-400 tabular-nums">{v.txCount} tx</span>
                        <span className="text-xs text-zinc-400 tabular-nums">{v.stmtCount} mo</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
            <button
              onClick={handleFindDuplicates}
              className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
              title="Find duplicate payee names"
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
              Find Duplicates
            </button>
            {bulkEditMode ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelBulkEdit}
                  className="border border-zinc-300 bg-transparent text-zinc-500 rounded-lg px-3 py-1.5 text-xs hover:bg-zinc-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkSave}
                  disabled={bulkEditCount === 0}
                  className="bg-zinc-800 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                >
                  Save All{bulkEditCount > 0 ? ` (${bulkEditCount})` : ''}
                </button>
              </div>
            ) : (
              <button
                onClick={enterBulkEdit}
                className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
                title="Edit all payee names at once"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                Edit All
              </button>
            )}
            {selectedList.length >= 2 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{selectedList.length} selected</span>
                {!mergeTarget ? (
                  <button
                    onClick={() => setMergeTarget(selectedList[0])}
                    className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
                  >
                    <Merge className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Merge Selected
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-zinc-400">into</span>
                    <Select
                      value={mergeTarget}
                      onChange={setMergeTarget}
                      options={selectedList.map(name => ({ value: name, label: name }))}
                      buttonClassName="px-2.5 py-1 text-xs min-w-[180px]"
                    />
                    <button
                      onClick={handleMerge}
                      className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1 text-xs font-medium hover:bg-zinc-50 transition-colors"
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
                    <tr key={p.payee} className={`hover:bg-zinc-50 transition-colors ${bulkEditMode ? 'bg-zinc-50/50' : ''} ${isEditing ? 'bg-zinc-50' : ''} ${isSelected ? 'bg-zinc-50' : ''}`}>
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
                        {bulkEditMode ? (
                          <input
                            className="input py-1 px-2 text-sm w-full"
                            value={bulkEdits[p.payee] ?? p.payee}
                            onChange={(e) => handleBulkChange(p.payee, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') cancelBulkEdit();
                            }}
                          />
                        ) : isEditing ? (
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
                        ) : bulkEditMode ? (
                          <span className="text-xs text-zinc-400">editing...</span>
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
