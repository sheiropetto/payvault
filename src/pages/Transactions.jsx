import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Filter, Search, Save, CheckCircle2, AlertCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Maximize2, Minimize2,
  CheckSquare, Square, FileText, Replace, Printer, Check
} from 'lucide-react';
import { api } from '../utils/api';
import { useCompany } from '../contexts/CompanyContext';
import { useFullView } from '../contexts/FullViewContext';
import { generateB5VoucherHTML, printB5Vouchers } from '../utils/format';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Select from '../components/ui/Select';

// Editable currency cell with formatted display
function CurrencyCell({ value, onChange, className }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const num = Number(value) || 0;

  function handleDoubleClick() {
    setDraft(num.toFixed(2));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 50);
  }

  function handleBlur() {
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) {
      onChange(parsed);
    }
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { inputRef.current?.blur(); }
    if (e.key === 'Escape') { setEditing(false); }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        className="w-full bg-white border border-zinc-400 rounded px-1.5 py-0.5 text-sm text-right
          focus:outline-none focus:ring-1 focus:ring-zinc-900"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:bg-zinc-100 rounded px-1 -mx-1 ${className || ''}`}
      onDoubleClick={handleDoubleClick}
      title="Double-click to edit"
    >
      {num > 0 ? num.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
    </span>
  );
}

// Resizable column header
function ResizableTh({ children, className, initialWidth }) {
  const ref = useRef(null);

  function handleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const th = ref.current;
    if (!th) return;
    const startWidth = th.offsetWidth;

    function onMouseMove(ev) {
      const newWidth = Math.max(60, startWidth + (ev.clientX - startX));
      th.style.width = `${newWidth}px`;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  return (
    <th ref={ref} className={`relative select-none ${className || ''}`}
      style={{ width: initialWidth, minWidth: 60 }}>
      {children}
      {/* Visible resize handle — wider for easier grab */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10
          before:absolute before:right-0 before:top-0 before:bottom-0 before:w-px before:bg-zinc-200
          hover:before:bg-zinc-500 hover:before:w-0.5"
        onMouseDown={handleMouseDown}
      />
    </th>
  );
}

const sortFields = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description' },
  { key: 'payee', label: 'To' },
  { key: 'debit_amount', label: 'Debit' },
  { key: 'credit_amount', label: 'Credit' },
  { key: 'balance', label: 'Balance' },
];

export default function Transactions() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { fullView, setFullView } = useFullView();
  const [statements, setStatements] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStmt, setSelectedStmt] = useState('');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('asc');

  const saveTimeoutRef = useRef(null);
  const transactionsRef = useRef([]);

  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  // Find & Replace
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // Print settings
  const [printSettings, setPrintSettings] = useState({
    pageSize: 'A5',
    orientation: 'landscape',
    combine: false,
  });

  // Column Filters
  const [columnFilters, setColumnFilters] = useState({
    payee: '',
    category: '',
    vouchered: '', // 'yes', 'no', or ''
  });
  const [activeFilterPopover, setActiveFilterPopover] = useState(null); // 'payee' | 'category' | 'vouchered' | null
  const [payeeFilterSearch, setPayeeFilterSearch] = useState('');

  const uniquePayees = useMemo(() => {
    return [...new Set(transactions.map(t => t.payee).filter(Boolean))].sort();
  }, [transactions]);

  const uniqueCategories = useMemo(() => {
    return [...new Set(transactions.map(t => t.category).filter(Boolean))].sort();
  }, [transactions]);

  useEffect(() => {
    if (selectedCompanyId) loadStatements();
  }, [selectedCompanyId]);

  // Reset full view when leaving the page
  useEffect(() => {
    return () => setFullView(false);
  }, []);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      const matchSearch = !search ||
        tx.description?.toLowerCase().includes(search.toLowerCase()) ||
        tx.category?.toLowerCase().includes(search.toLowerCase()) ||
        tx.payee?.toLowerCase().includes(search.toLowerCase());
      const matchCategory = !filterCategory || tx.category === filterCategory;
      const matchType = filterType === 'all' ||
        (filterType === 'debit' && (tx.debit_amount > 0)) ||
        (filterType === 'credit' && (tx.credit_amount > 0));

      const matchColCategory = !columnFilters.category || tx.category === columnFilters.category;

      const matchColPayee = !columnFilters.payee ||
        tx.payee === columnFilters.payee ||
        (tx.description && tx.description.toLowerCase().includes(columnFilters.payee.toLowerCase()));

      const matchColVouchered = !columnFilters.vouchered ||
        (columnFilters.vouchered === 'yes' && tx.is_vouchered) ||
        (columnFilters.vouchered === 'no' && !tx.is_vouchered);

      return matchSearch && matchCategory && matchType && matchColCategory && matchColPayee && matchColVouchered;
    });
  }, [transactions, search, filterCategory, filterType, columnFilters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (sortField === 'date') {
        aVal = a.date || '';
        bVal = b.date || '';
      } else if (sortField === 'debit_amount' || sortField === 'credit_amount' || sortField === 'balance') {
        aVal = Number(a[sortField]) || 0;
        bVal = Number(b[sortField]) || 0;
      } else {
        aVal = (a[sortField] || '').toLowerCase();
        bVal = (b[sortField] || '').toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDir]);

  async function loadStatements() {
    try {
      const stmts = await api.getStatements(selectedCompanyId);
      setStatements(stmts.filter(s => s.status === 'done'));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedStmt) {
      loadTransactions(selectedStmt);
    } else {
      setTransactions([]);
    }
  }, [selectedStmt]);

  async function loadTransactions(stmtId) {
    setLoading(true);
    try {
      const txs = await api.getTransactions(stmtId);
      setTransactions(txs);
      setEdits({});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const triggerAutoSave = useCallback((updatedEdits) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      const updates = Object.entries(updatedEdits)
        .filter(([, v]) => v._dirty)
        .map(([id, v]) => {
          const { _dirty, ...fields } = v;
          return { id, ...fields };
        });

      if (!updates.length) return;

      setSaving(true);
      setSaveStatus({ type: 'syncing', message: 'Syncing changes...' });
      try {
        await api.updateTransactions(updates);
        setSaveStatus({ type: 'success', message: 'All changes synced' });

        setEdits(prev => {
          const next = { ...prev };
          updates.forEach(up => {
            if (next[up.id]) {
              const { _dirty, ...fields } = next[up.id];
              let matches = true;
              for (const key of Object.keys(fields)) {
                if (fields[key] !== up[key]) matches = false;
              }
              if (matches) delete next[up.id];
            }
          });
          return next;
        });

        setTransactions(prev => prev.map(tx => {
          const up = updates.find(u => u.id === tx.id);
          if (up) {
            return { ...tx, ...up, is_edited: 1 };
          }
          return tx;
        }));

        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err) {
        setSaveStatus({ type: 'error', message: `Sync failed: ${err.message}` });
      } finally {
        setSaving(false);
      }
    }, 1000);
  }, []);

  const handleEdit = useCallback((id, field, value) => {
    setEdits(prev => {
      const nextEdits = {
        ...prev,
        [id]: { ...prev[id], [field]: value, _dirty: true },
      };
      triggerAutoSave(nextEdits);
      return nextEdits;
    });
  }, [triggerAutoSave]);

  async function handleSave() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const updates = Object.entries(edits)
      .filter(([, v]) => v._dirty)
      .map(([id, v]) => {
        const { _dirty, ...fields } = v;
        return { id, ...fields };
      });

    if (!updates.length) return;

    setSaving(true);
    setSaveStatus({ type: 'syncing', message: 'Saving...' });
    try {
      await api.updateTransactions(updates);
      setSaveStatus({ type: 'success', message: 'Saved successfully' });
      setEdits({});
      await loadTransactions(selectedStmt);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  }

  const categories = [...new Set(transactions.map(t => t.category).filter(Boolean))];
  const hasEdits = Object.values(edits).some(v => v._dirty);

  // Selection helpers
  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllDebit() {
    const debitIds = filtered.filter(tx => tx.debit_amount > 0).map(tx => tx.id);
    setSelected(new Set(debitIds));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Step 1: Convert selected to vouchers (DB write only)
  async function handleConvertToVouchers() {
    const newTxs = sorted.filter(tx => selected.has(tx.id) && tx.debit_amount > 0 && !tx.is_vouchered);
    if (!newTxs.length) return;

    try {
      for (const tx of newTxs) {
        const edit = edits[tx.id] || {};
        const particularsVal = edit.particulars ?? tx.particulars ?? 'Payment';
        await api.createVoucher({
          company_id: selectedCompanyId,
          payee: tx.payee || '',
          amount: tx.debit_amount || 0,
          date: tx.date || '',
          description: particularsVal,
          category: tx.category || '',
          payment_method: 'Transfer',
          status: 'approved',
          transaction_ids: [tx.id],
        });
      }
      setSaveStatus({ type: 'success', message: `${newTxs.length} voucher(s) created.` });
      await loadTransactions(selectedStmt);
      // Keep selection so user can print immediately
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err) {
      setSaveStatus({ type: 'error', message: err.message });
    }
  }

  // Build voucher HTML respecting settings (including combine)
  function buildVoucherHTML(txs) {
    const isCombined = printSettings.combine && printSettings.pageSize === 'A5';
    const items = txs.map(tx => {
      const edit = edits[tx.id] || {};
      const particularsVal = edit.particulars ?? tx.particulars ?? 'Payment';
      return generateB5VoucherHTML({
        payee: tx.payee || '',
        date: tx.date || '',
        description: particularsVal,
        amount: tx.debit_amount || 0,
        paymentMethod: 'Transfer',
        company: selectedCompany || {},
        ...printSettings,
        combine: isCombined,
      });
    });

    // Combine: 2× A5 landscape vouchers stacked on A4 portrait
    if (isCombined) {
      const pairs = [];
      for (let i = 0; i < items.length; i += 2) {
        const pair = items.slice(i, i + 2);
        pairs.push(`<div style="
          width:210mm;height:297mm;padding:0;box-sizing:border-box;
          display:flex;flex-direction:column;align-items:center;
          background:#fff;margin:0 auto 12px;
          box-shadow:0 1px 4px rgba(0,0,0,0.08);page-break-after:always;
        ">${pair.join('')}</div>`);
      }
      return pairs.join('');
    }

    return items.join('');
  }

  // Step 2: Print/PDF selected (no DB write)
  function handlePrintSelected() {
    const txs = sorted.filter(tx => selected.has(tx.id) && tx.debit_amount > 0);
    if (!txs.length) return;
    const effectiveSettings = printSettings.combine && printSettings.pageSize === 'A5'
      ? { pageSize: 'A4', orientation: 'portrait', combine: true }
      : printSettings;
    printB5Vouchers(buildVoucherHTML(txs), effectiveSettings);
  }



  // Find & Replace logic
  const findMatches = useMemo(() => {
    if (!findText.trim()) return [];
    const lower = findText.toLowerCase();
    return sorted.filter(tx => tx.payee?.toLowerCase().includes(lower));
  }, [sorted, findText]);

  async function handleReplaceAll() {
    if (!findText.trim() || !findMatches.length) return;
    const updates = findMatches.map(tx => ({
      id: tx.id,
      payee: replaceText,
    }));
    try {
      await api.updateTransactions(updates);
      setSaveStatus({ type: 'success', message: `${findMatches.length} payee(s) replaced.` });
      setFindText('');
      setReplaceText('');
      await loadTransactions(selectedStmt);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus({ type: 'error', message: err.message });
    }
  }

  if (loading && !transactions.length) return <LoadingSpinner />;

  return (
    <div>
      {activeFilterPopover && (
        <div
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setActiveFilterPopover(null)}
        />
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Transactions</h1>
          <p className="text-sm text-zinc-500 mt-1">Review and edit extracted transactions</p>
        </div>
        <button
          onClick={() => setFullView(!fullView)}
          className="btn-secondary flex items-center gap-2"
          title={fullView ? 'Exit full view' : 'Full view'}
        >
          {fullView ? (
            <><Minimize2 className="w-4 h-4" strokeWidth={1.5} /> Exit Full View</>
          ) : (
            <><Maximize2 className="w-4 h-4" strokeWidth={1.5} /> Full View</>
          )}
        </button>
      </div>

      {/* Controls */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="w-full sm:w-72">
            <label className="label">Bank Statement</label>
            <Select
              value={selectedStmt}
              onChange={setSelectedStmt}
              placeholder="Select a statement..."
              options={statements.map((s) => ({ value: s.id, label: s.filename }))}
            />
          </div>
          {selectedStmt && (
            <>
              <div className="flex-1 w-full">
                <label className="label">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                  <input
                    className="input pl-9"
                    placeholder="Search description..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="w-40">
                <label className="label">Category</label>
                <Select
                  value={filterCategory}
                  onChange={setFilterCategory}
                  placeholder="All"
                  options={[{ value: '', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))] }
                />
              </div>
              <div className="w-32">
                <label className="label">Type</label>
                <Select
                  value={filterType}
                  onChange={setFilterType}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'debit', label: 'Debit Only' },
                    { value: 'credit', label: 'Credit Only' }
                  ]}
                />
              </div>
              <div>
                <button
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={!hasEdits || saving}
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {hasEdits ? `Save (${Object.values(edits).filter(v => v._dirty).length})` : 'Saved'}
                </button>
              </div>
            </>
          )}
        </div>

        {saveStatus && (
          <div className={`mt-3 flex items-center gap-2 text-xs ${
            saveStatus.type === 'success' ? 'text-green-600' : 'text-red-600'
          }`}>
            {saveStatus.type === 'success'
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <AlertCircle className="w-3.5 h-3.5" />
            }
            {saveStatus.message}
          </div>
        )}

        {/* Selection toolbar */}
        {selectedStmt && filtered.length > 0 && (
          <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center gap-3 flex-wrap">
            <button
              className="btn-ghost text-xs flex items-center gap-1.5"
              onClick={selectAllDebit}
            >
              <CheckSquare className="w-3.5 h-3.5" strokeWidth={1.5} />
              Select All Debit
            </button>
            {selected.size > 0 && (() => {
                const selVouchered = sorted.filter(tx => selected.has(tx.id) && tx.is_vouchered && tx.debit_amount > 0).length;
                const selNew = sorted.filter(tx => selected.has(tx.id) && !tx.is_vouchered && tx.debit_amount > 0).length;
                return (
              <>
                <span className="text-xs text-zinc-500">{selected.size} selected</span>
                {/* Step 1: Convert new ones */}
                {selNew > 0 && (
                  <button
                    className="btn-primary text-xs flex items-center gap-1.5"
                    onClick={handleConvertToVouchers}
                  >
                    <FileText className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Convert to Vouchers ({selNew})
                  </button>
                )}
                {/* Step 2: Print/PDF for all selected (after convert or reprint) */}
                {(selNew === 0 || selVouchered > 0) && (
                  <>
                    <button
                      className="btn-secondary text-xs flex items-center gap-1.5"
                      onClick={handlePrintSelected}
                    >
                      <Printer className="w-3.5 h-3.5" strokeWidth={1.5} /> Print ({selVouchered || selected.size})
                    </button>
                  </>
                )}
                <button className="btn-ghost text-xs" onClick={clearSelection}>
                  Clear
                </button>
              </>
              );
              })()}
          </div>
        )}
      </div>

      {/* Find & Replace + Print Settings */}
      {selectedStmt && (
        <div className="card mb-6">
          <div className="flex items-center gap-6">
            <button
              className="flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900"
              onClick={() => setShowFindReplace(!showFindReplace)}
            >
              <Replace className="w-4 h-4" strokeWidth={1.5} />
              Find & Replace
            </button>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-zinc-400">Print:</span>
              <Select
                className="w-20"
                buttonClassName="py-1 px-2 text-xs"
                value={printSettings.pageSize}
                onChange={val => setPrintSettings(s => ({ ...s, pageSize: val, combine: val === 'A4' ? false : s.combine }))}
                options={[
                  { value: 'A5', label: 'A5' },
                  { value: 'A4', label: 'A4' }
                ]}
              />
              <Select
                className="w-24"
                buttonClassName="py-1 px-2 text-xs"
                value={printSettings.orientation}
                onChange={val => setPrintSettings(s => ({ ...s, orientation: val }))}
                options={[
                  { value: 'landscape', label: 'Landscape' },
                  { value: 'portrait', label: 'Portrait' }
                ]}
              />
              {printSettings.pageSize === 'A5' && (
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-zinc-300"
                    checked={printSettings.combine}
                    onChange={e => setPrintSettings(s => ({ ...s, combine: e.target.checked }))}
                  />
                  2× on A4
                </label>
              )}
            </div>
          </div>
          {showFindReplace && (
            <div className="mt-3 pt-3 border-t border-zinc-100">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label">Find in TO column</label>
                  <input
                    className="input"
                    placeholder="Search payee name..."
                    value={findText}
                    onChange={e => setFindText(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="label">Replace with</label>
                  <input
                    className="input"
                    placeholder="Full name..."
                    value={replaceText}
                    onChange={e => setReplaceText(e.target.value)}
                  />
                </div>
                <button
                  className="btn-primary"
                  disabled={!findText.trim() || !findMatches.length}
                  onClick={handleReplaceAll}
                >
                  Replace All ({findMatches.length})
                </button>
              </div>
              {findText.trim() && (
                <p className="mt-2 text-xs text-zinc-500">
                  {findMatches.length > 0
                    ? `${findMatches.length} match(es) found — will replace all with "${replaceText || '(empty)'}"`
                    : 'No matches found'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Transactions Sheet */}
      {!selectedStmt ? (
        <EmptyState
          icon={Filter}
          title="Select a statement"
          description="Choose a processed bank statement to view its transactions."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No transactions found"
          description={search ? 'Try a different search term' : 'No transactions in this statement'}
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="sheet-grid">
              <thead>
                <tr>
                  <th className="w-10 px-2 py-3 border-b border-zinc-200 bg-zinc-50" />
                  {[
                    { key: 'date', label: 'Date', width: 110 },
                    { key: 'description', label: 'Description / Payee', width: 260 },
                    { key: 'particulars', label: 'Particulars', width: 160 },
                    { key: 'payee', label: 'To', width: 180 },
                    { key: 'category', label: 'Category', width: 130 },
                    { key: 'debit_amount', label: 'Debit (RM)', width: 120, className: 'text-right' },
                    { key: 'credit_amount', label: 'Credit (RM)', width: 120, className: 'text-right' },
                    { key: 'balance', label: 'Balance', width: 120, className: 'text-right' },
                    { key: null, label: 'Vouchered', width: 80, className: 'text-center' },
                  ].map(col => (
                    <ResizableTh
                      key={col.key || 'vouchered'}
                      className={`select-none ${col.className || ''}`}
                      initialWidth={col.width}
                    >
                      <div className="flex items-center justify-between gap-1 w-full relative">
                        <span
                          className={`inline-flex items-center gap-1 cursor-pointer hover:text-zinc-900 ${col.key ? '' : ''}`}
                          onClick={() => col.key && toggleSort(col.key)}
                        >
                          {col.label}
                          {col.key === sortField ? (
                            sortDir === 'asc'
                              ? <ArrowUp className="w-3 h-3" strokeWidth={2} />
                              : <ArrowDown className="w-3 h-3" strokeWidth={2} />
                          ) : col.key ? (
                            <ArrowUpDown className="w-3 h-3 text-zinc-300" strokeWidth={1.5} />
                          ) : null}
                        </span>

                        {/* Column Filter Popover */}
                        {['payee', 'category', 'vouchered'].includes(col.key || (col.label === 'Vouchered' ? 'vouchered' : '')) && (
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const type = col.key || 'vouchered';
                                setActiveFilterPopover(activeFilterPopover === type ? null : type);
                                if (type === 'payee') setPayeeFilterSearch('');
                              }}
                              className={`p-0.5 rounded hover:bg-zinc-200 transition-colors ${columnFilters[col.key || 'vouchered'] ? 'bg-zinc-100' : ''}`}
                              title="Filter column"
                            >
                              <Filter
                                className={`w-3.5 h-3.5 ${columnFilters[col.key || 'vouchered'] ? 'text-zinc-950 fill-zinc-900 font-bold' : 'text-zinc-400 hover:text-zinc-600'}`}
                                strokeWidth={2}
                              />
                            </button>

                            {activeFilterPopover === (col.key || 'vouchered') && (
                              <div className="absolute top-full right-0 mt-1.5 p-2 bg-white border border-zinc-200 rounded-lg shadow-lg z-30 min-w-48 text-left font-normal normal-case text-xs text-zinc-700">
                                {col.key === 'payee' && (
                                  <input
                                    className="input py-1 px-2 text-xs mb-2"
                                    placeholder="Search payee..."
                                    value={payeeFilterSearch}
                                    onChange={(e) => setPayeeFilterSearch(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    autoFocus
                                  />
                                )}

                                <div className="max-h-48 overflow-y-auto space-y-0.5">
                                  <button
                                    onClick={() => {
                                      setColumnFilters(prev => ({ ...prev, [col.key || 'vouchered']: '' }));
                                      setActiveFilterPopover(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-50 flex items-center justify-between"
                                  >
                                    <span className="font-medium text-zinc-500">All / Clear</span>
                                    {!columnFilters[col.key || 'vouchered'] && <Check className="w-3 h-3 text-zinc-900" strokeWidth={2} />}
                                  </button>

                                  {col.key === 'category' && uniqueCategories.map(c => (
                                    <button
                                      key={c}
                                      onClick={() => {
                                        setColumnFilters(prev => ({ ...prev, category: c }));
                                        setActiveFilterPopover(null);
                                      }}
                                      className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-50 flex items-center justify-between"
                                    >
                                      <span>{c}</span>
                                      {columnFilters.category === c && <Check className="w-3 h-3 text-zinc-900" strokeWidth={2} />}
                                    </button>
                                  ))}

                                  {col.key === 'payee' && uniquePayees
                                    .filter(p => p.toLowerCase().includes(payeeFilterSearch.toLowerCase()))
                                    .slice(0, 30)
                                    .map(p => (
                                      <button
                                        key={p}
                                        onClick={() => {
                                          setColumnFilters(prev => ({ ...prev, payee: p }));
                                          setActiveFilterPopover(null);
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-50 flex items-center justify-between"
                                      >
                                        <span className="truncate pr-1">{p}</span>
                                        {columnFilters.payee === p && <Check className="w-3 h-3 text-zinc-900" strokeWidth={2} />}
                                      </button>
                                    ))
                                  }

                                  {col.label === 'Vouchered' && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setColumnFilters(prev => ({ ...prev, vouchered: 'yes' }));
                                          setActiveFilterPopover(null);
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-50 flex items-center justify-between"
                                      >
                                        <span>Vouchered Only</span>
                                        {columnFilters.vouchered === 'yes' && <Check className="w-3 h-3 text-zinc-900" strokeWidth={2} />}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setColumnFilters(prev => ({ ...prev, vouchered: 'no' }));
                                          setActiveFilterPopover(null);
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-50 flex items-center justify-between"
                                      >
                                        <span>Not Vouchered Only</span>
                                        {columnFilters.vouchered === 'no' && <Check className="w-3 h-3 text-zinc-900" strokeWidth={2} />}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((tx) => {
                  const edit = edits[tx.id] || {};
                  return (
                    <tr key={tx.id}>
                      <td className="text-center align-middle px-2">
                        <button
                          onClick={() => toggleSelect(tx.id)}
                          className="text-zinc-400 hover:text-zinc-700"
                        >
                          {selected.has(tx.id)
                            ? <CheckSquare className="w-4 h-4" strokeWidth={1.5} />
                            : <Square className="w-4 h-4" strokeWidth={1.5} />
                          }
                        </button>
                      </td>
                      <td>
                        <input
                          type="date"
                          className="input py-1 px-2 text-sm"
                          value={edit.date ?? tx.date?.slice(0, 10) ?? ''}
                          onChange={(e) => handleEdit(tx.id, 'date', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="input py-1 px-2 text-sm"
                          value={edit.description ?? tx.description ?? ''}
                          onChange={(e) => handleEdit(tx.id, 'description', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="input py-1 px-2 text-sm"
                          value={edit.particulars ?? tx.particulars ?? 'Payment'}
                          onChange={(e) => handleEdit(tx.id, 'particulars', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="input py-1 px-2 text-sm"
                          value={edit.payee ?? tx.payee ?? ''}
                          onChange={(e) => handleEdit(tx.id, 'payee', e.target.value)}
                          placeholder="—"
                        />
                      </td>
                      <td>
                        <Select
                          buttonClassName="py-1 px-2 text-sm"
                          value={edit.category ?? tx.category ?? ''}
                          onChange={(val) => handleEdit(tx.id, 'category', val)}
                          options={[
                            { value: '', label: 'Select' },
                            ...['Payment', 'Credit/Deposit', 'Fund Transfer', 'Bank Fee', 'Interest', 'Other'].map(c => ({ value: c, label: c }))
                          ]}
                        />
                      </td>
                      <td className="text-right align-middle">
                        <CurrencyCell
                          value={edit.debit_amount ?? tx.debit_amount ?? 0}
                          onChange={(v) => handleEdit(tx.id, 'debit_amount', v)}
                          className="text-sm"
                        />
                      </td>
                      <td className="text-right align-middle">
                        <CurrencyCell
                          value={edit.credit_amount ?? tx.credit_amount ?? 0}
                          onChange={(v) => handleEdit(tx.id, 'credit_amount', v)}
                          className="text-sm"
                        />
                      </td>
                      <td className="text-right text-zinc-600 text-sm align-middle px-3 py-2">
                        {tx.balance != null ? Number(tx.balance).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="text-center">
                        {tx.is_vouchered ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 inline" strokeWidth={1.5} />
                        ) : (
                          <span className="text-sm text-zinc-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-zinc-100 text-sm text-zinc-400">
            {sorted.length} of {transactions.length} transactions
            {sortField !== 'date' && ' · sorted by ' + sortFields.find(f => f.key === sortField)?.label}
          </div>
        </div>
      )}
    </div>
  );
}
