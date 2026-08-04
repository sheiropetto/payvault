import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Pencil, Check, X, Users, Square, CheckSquare, Merge, Sparkles, Circle, Download, Printer, ShieldCheck, AlertTriangle, BarChart3 } from 'lucide-react';
import { api } from '../utils/api';
import { formatCurrency } from '../utils/format';
import { useCompany } from '../contexts/CompanyContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Select from '../components/ui/Select';

// ─── Duplicate payee detection (normalization + fuzzy matching) ───
const OCR_NOISE_RE = /[\]\[|!@#"$%^&*()_+=<>?`~;,:'\\]/g;
const STRUCTURE_TOKENS = new Set(['sdn', 'bhd', 'berhad', 's/b', 'sdnbhd', 'ltd', 'inc', 'llc', 'pte', 'ptd']);
const HONORIFICS = new Set([
  'cik', 'encik', 'en', 'pn', 'ci', 'dato', 'datuk', 'datin', 'haji', 'hajjah', 'hajah',
  'mr', 'mrs', 'ms', 'dr', 'ir', 'tuan', 'puan', 'sir', 'madam', 'allahyarham', 'arwah',
]);

function normalizeKey(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/&/g, ' and ');              // & → and
  s = s.replace(OCR_NOISE_RE, ' ');          // OCR noise chars → space
  s = s.replace(/\./g, ' ');                 // dots → space (SDN. BHD. → SDN BHD)
  s = s.replace(/\bbint[e]?\b/g, ' binti '); // BINT / BINTE / BINTI → BINTI
  s = s.replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean);
  // Drop honorific titles and pure legal-structure tokens; keep identity words.
  return words
    .filter(w => !HONORIFICS.has(w.replace(/'/g, '')) && !STRUCTURE_TOKENS.has(w))
    .join(' ');
}

function jaroWinkler(a, b) {
  if (a === b) return 1;
  const lenA = a.length, lenB = b.length;
  if (!lenA || !lenB) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(lenA, lenB) / 2) - 1);
  const aMatch = new Array(lenA).fill(false);
  const bMatch = new Array(lenB).fill(false);
  let matches = 0;
  for (let i = 0; i < lenA; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, lenB);
    for (let j = start; j < end; j++) {
      if (!bMatch[j] && a[i] === b[j]) { aMatch[i] = true; bMatch[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < lenA; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / lenA + matches / lenB + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  const maxPrefix = Math.min(4, lenA, lenB);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function tokenSimilarity(a, b) {
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  if (!ta.length && !tb.length) return 1;
  const sa = new Set(ta), sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function tokenContainment(a, b) {
  const ta = a.split(' ').filter(Boolean);
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.length) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits / ta.length;
}

function nameSimilarity(a, b) {
  return Math.max(jaroWinkler(a, b), tokenSimilarity(a, b));
}

export default function Payees() {
  const { selectedCompanyId, selectedCompany } = useCompany();
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
  const [statements, setStatements] = useState([]);
  const [year, setYear] = useState('');
  const yearRef = useRef('');
  const restoreScrollRef = useRef(null);

  // Batch duplicate groups: { variants: string[], selected: string }
  const [duplicateGroups, setDuplicateGroups] = useState(null);

  // Bulk edit mode: edits all names at once
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkEdits, setBulkEdits] = useState({});

  // Tabs: 'payees' | 'summary'
  const [view, setView] = useState('payees');

  const allYears = useMemo(() => {
    return [...new Set(statements.map(s => s.year).filter(Boolean))].sort((a, b) => b - a);
  }, [statements]);

  useEffect(() => { yearRef.current = year; }, [year]);

  useEffect(() => {
    if (selectedCompanyId) {
      setYear('');
      setSelected(new Set());
      setMergeTarget(null);
      setStatements([]);
      loadStatements();
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedCompanyId) loadPayees();
  }, [selectedCompanyId, year]);

  async function loadStatements() {
    try {
      const data = await api.getStatements(selectedCompanyId);
      setStatements(data || []);
    } catch (err) {
      console.error('Failed to load statements:', err);
      setStatements([]);
    }
  }

  async function loadPayees(silent = false) {
    // Silent refreshes (after rename/merge/save) keep the page mounted so the
    // scroll position is preserved instead of the full-page spinner jumping to top.
    if (!silent) setLoading(true);
    const restoreY = silent ? window.scrollY : null;
    try {
      const reqYear = yearRef.current;
      const data = await api.getPayees(selectedCompanyId, reqYear);
      // Ignore stale responses if the year changed while this request was in flight
      if (reqYear === yearRef.current) {
        setPayees(data);
        if (restoreY != null) restoreScrollRef.current = restoreY;
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // After a silent refresh, put the viewport back where the user was.
  useEffect(() => {
    if (restoreScrollRef.current == null) return;
    const y = restoreScrollRef.current;
    restoreScrollRef.current = null;
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }, [payees]);

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function handleExportCSV() {
    const rows = filtered.length ? filtered : payees;
    if (!rows.length) return;
    const headers = ['Payee', 'Transactions', 'Months', 'Debit (RM)', 'Credit (RM)', 'Net (RM)'];
    const csvRows = [headers.join(',')];
    for (const p of rows) {
      const debit = Number(p.total_debit) || 0;
      const credit = Number(p.total_credit) || 0;
      csvRows.push([
        `"${(p.payee || '').replace(/"/g, '""')}"`,
        p.tx_count || 0,
        p.stmt_count || 0,
        debit.toFixed(2),
        credit.toFixed(2),
        (debit - credit).toFixed(2),
      ].join(','));
    }

    // Monthly breakdown (long format) when a single year is selected
    if (year) {
      const monthly = await api.getPayeeMonthly(selectedCompanyId, year).catch(() => []);
      if (monthly.length) {
        csvRows.push('');
        csvRows.push(`MONTHLY BREAKDOWN - ${year}`);
        csvRows.push(['Payee', 'Month', 'Debit (RM)', 'Credit (RM)'].join(','));
        const sortedMonthly = [...monthly].sort((a, b) => a.payee.localeCompare(b.payee) || (a.month - b.month));
        for (const m of sortedMonthly) {
          csvRows.push([
            `"${(m.payee || '').replace(/"/g, '""')}"`,
            `${year}-${String(m.month).padStart(2, '0')}`,
            (Number(m.total_debit) || 0).toFixed(2),
            (Number(m.total_credit) || 0).toFixed(2),
          ].join(','));
        }
      }
    }

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payee-report${year ? `-${year}` : '-all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrintReport() {
    const rows = filtered.length ? filtered : payees;
    if (!rows.length) return;
    const companyName = selectedCompany?.name || 'Company';
    const yearLabel = year ? String(year) : 'All Years';
    const sorted = [...rows].sort((a, b) => (Number(b.total_debit) || 0) - (Number(a.total_debit) || 0));
    const totalDebit = sorted.reduce((s, p) => s + (Number(p.total_debit) || 0), 0);

    // Yearly summary list (payments out per payee)
    const summaryRows = sorted.map(p => `
      <tr>
        <td>${esc(p.payee)}</td>
        <td class="num">${formatCurrency(p.total_debit)}</td>
      </tr>
    `).join('');

    // Monthly breakdown (only meaningful for a single year)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let monthly = [];
    if (year) {
      monthly = await api.getPayeeMonthly(selectedCompanyId, year).catch(() => []);
    }

    function matrixHtml(type) {
      const byPayee = {};
      for (const m of monthly) {
        if (!byPayee[m.payee]) byPayee[m.payee] = Array(12).fill(0);
        const val = Number(type === 'debit' ? m.total_debit : m.total_credit) || 0;
        byPayee[m.payee][m.month - 1] += val;
      }
      const names = Object.keys(byPayee)
        .filter(name => byPayee[name].some(v => v > 0))
        .sort((a, b) => {
          const sumA = byPayee[a].reduce((s, v) => s + v, 0);
          const sumB = byPayee[b].reduce((s, v) => s + v, 0);
          return sumB - sumA;
        });
      if (!names.length) return `<p class="muted">No ${type} transactions for ${esc(yearLabel)}.</p>`;
      const colTotals = Array(12).fill(0);
      const bodyRows = names.map(name => {
        const cells = byPayee[name].map((v, i) => {
          colTotals[i] += v;
          return `<td class="num">${v ? formatCurrency(v) : ''}</td>`;
        }).join('');
        const rowTotal = byPayee[name].reduce((s, v) => s + v, 0);
        return `<tr><td>${esc(name)}</td>${cells}<td class="num strong">${formatCurrency(rowTotal)}</td></tr>`;
      }).join('');
      const totalCells = colTotals.map(v => `<td class="num">${v ? formatCurrency(v) : ''}</td>`).join('');
      return `<table class="report-table matrix">
        <thead><tr><th>Payee</th>${monthNames.map(mn => `<th class="num">${mn}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>
          ${bodyRows}
          <tr class="total"><td>All payees</td>${totalCells}<td class="num strong">${formatCurrency(colTotals.reduce((s, v) => s + v, 0))}</td></tr>
        </tbody>
      </table>`;
    }

    const html = `
      <style>
        .report-wrap { font-family: 'Inter', system-ui, sans-serif; color: #18181b; }
        .report-head { text-align: center; margin-bottom: 20px; }
        .report-head h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
        .report-head p { font-size: 12px; color: #52525b; margin: 2px 0; }
        .report-section { margin-top: 26px; }
        .report-section h2 { font-size: 13px; font-weight: 600; color: #18181b; margin: 0 0 8px; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .report-table.matrix { font-size: 10px; }
        .report-table th { text-align: left; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; color: #52525b; padding: 6px 8px; border-bottom: 1px solid #d4d4d8; }
        .report-table td { padding: 6px 8px; border-bottom: 1px solid #e4e4e7; }
        .report-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .report-table .strong { font-weight: 600; }
        .report-table tr.total td { font-weight: 600; border-top: 2px solid #d4d4d8; border-bottom: none; }
        .muted { color: #71717a; font-size: 11px; }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .report-section { page-break-inside: avoid; }
        }
      </style>
      <div class="report-wrap">
        <div class="report-head">
          <h1>Payee Report — ${esc(companyName)}</h1>
          <p>Year: ${esc(yearLabel)} &nbsp;·&nbsp; Generated: ${esc(new Date().toLocaleString('en-MY'))}</p>
        </div>

        <div class="report-section">
          <h2>Yearly Summary — Total Payments Out</h2>
          <table class="report-table">
            <thead><tr><th>Payee</th><th class="num">Total (RM)</th></tr></thead>
            <tbody>
              ${summaryRows}
              <tr class="total"><td>Total (${sorted.length} payee${sorted.length > 1 ? 's' : ''})</td><td class="num">${formatCurrency(totalDebit)}</td></tr>
            </tbody>
          </table>
        </div>

        ${year ? `
        <div class="report-section">
          <h2>Debit by Month — ${esc(year)}</h2>
          ${matrixHtml('debit')}
        </div>
        <div class="report-section">
          <h2>Credit by Month — ${esc(year)}</h2>
          ${matrixHtml('credit')}
        </div>` : ''}
      </div>`;

    // Print overlay (modeled on the voucher print preview)
    const existing = document.getElementById('payee-report-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'payee-report-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;overflow-y:auto;background:#f5f5f5;';

    const content = document.createElement('div');
    content.style.cssText = 'max-width:900px;margin:24px auto;padding:32px;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);';
    content.innerHTML = html;

    const toolbar = document.createElement('div');
    toolbar.className = 'no-print';
    toolbar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:14px 20px;background:#fff;border-top:1px solid #ddd;display:flex;justify-content:center;gap:12px;z-index:10001;box-shadow:0 -2px 8px rgba(0,0,0,0.08);';

    const printBtn = document.createElement('button');
    printBtn.textContent = 'Print';
    printBtn.style.cssText = 'padding:10px 28px;font-size:14px;cursor:pointer;background:#18181b;color:#fff;border:none;border-radius:8px;font-weight:500;';
    printBtn.onclick = () => window.print();

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:10px 28px;font-size:14px;cursor:pointer;background:#fff;color:#555;border:1px solid #ccc;border-radius:8px;';
    closeBtn.onclick = () => overlay.remove();

    toolbar.appendChild(printBtn);
    toolbar.appendChild(closeBtn);

    overlay.appendChild(content);
    overlay.appendChild(toolbar);
    document.body.appendChild(overlay);
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
    const used = new Set();
    const finalGroups = [];

    // Pass 1 — exact normalized keys → SAFE (formatting / OCR-only differences)
    const byKey = new Map();
    for (const p of payees) {
      const key = normalizeKey(p.payee);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p.payee);
    }
    for (const names of byKey.values()) {
      if (names.length < 2) continue;
      finalGroups.push(makeDuplicateGroup(names, 'safe'));
      names.forEach(n => used.add(n));
    }

    // Pass 2 — fuzzy matches among the rest → REVIEW (shared base, possibly distinct payments)
    const remaining = payees.filter(p => !used.has(p.payee) && normalizeKey(p.payee));
    for (let i = 0; i < remaining.length; i++) {
      const seed = remaining[i];
      if (used.has(seed.payee)) continue;
      const seedKey = normalizeKey(seed.payee);
      const cluster = [seed.payee];
      used.add(seed.payee);
      for (let j = i + 1; j < remaining.length; j++) {
        const cand = remaining[j];
        if (used.has(cand.payee)) continue;
        const candKey = normalizeKey(cand.payee);
        const sim = nameSimilarity(seedKey, candKey);
        const cont = Math.max(tokenContainment(seedKey, candKey), tokenContainment(candKey, seedKey));
        if (sim >= 0.86 || (sim >= 0.6 && cont >= 0.7)) {
          cluster.push(cand.payee);
          used.add(cand.payee);
        }
      }
      if (cluster.length >= 2) finalGroups.push(makeDuplicateGroup(cluster, 'review'));
    }

    if (finalGroups.length === 0) {
      setStatus({ type: 'success', message: 'No duplicates found.' });
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    setDuplicateGroups(finalGroups);
    setSelected(new Set());
    setMergeTarget(null);

    const safeCount = finalGroups.filter(g => g.tier === 'safe').length;
    const reviewCount = finalGroups.length - safeCount;
    const totalDupes = finalGroups.reduce((s, g) => s + g.variants.length - 1, 0);
    setStatus({
      type: 'success',
      message: `Found ${finalGroups.length} duplicate group(s) with ${totalDupes} redundant names — ${safeCount} safe to merge, ${reviewCount} need review.`,
    });
  }

  function makeDuplicateGroup(names, tier) {
    const withCounts = names.map(name => {
      const p = payees.find(x => x.payee === name);
      return { name, txCount: p?.tx_count || 0, stmtCount: p?.stmt_count || 0 };
    });
    withCounts.sort((a, b) => b.txCount - a.txCount);
    return {
      variants: withCounts,
      selected: withCounts[0].name, // default: highest tx count
      tier,
      included: tier === 'safe',    // safe groups auto-included; review groups opt-in
    };
  }

  function handleGroupToggle(groupIndex) {
    setDuplicateGroups(prev => {
      const next = [...prev];
      next[groupIndex] = { ...next[groupIndex], included: !next[groupIndex].included };
      return next;
    });
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
      .filter(g => g.included)
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
          await loadPayees(true);
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
          await loadPayees(true);
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
          await loadPayees(true);
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
          await loadPayees(true);
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

  const safeCount = (duplicateGroups || []).filter(g => g.tier === 'safe').length;
  const reviewCount = (duplicateGroups || []).length - safeCount;
  const includedGroups = (duplicateGroups || []).filter(g => g.included).length;

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

      {/* Duplicate groups — batch merge UI (Safe / Review tiers) */}
      {duplicateGroups && duplicateGroups.length > 0 && (
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-zinc-700">
                {duplicateGroups.length} duplicate group{duplicateGroups.length > 1 ? 's' : ''} found
              </h2>
              {reviewCount > 0 && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  {safeCount} safe · {reviewCount} to review
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearDuplicates}
                className="border border-zinc-300 bg-transparent text-zinc-500 rounded-lg px-3 py-1.5 text-xs hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchMerge}
                disabled={saving || includedGroups === 0}
                className="bg-zinc-800 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : `Save All${includedGroups ? ` (${includedGroups} group${includedGroups > 1 ? 's' : ''})` : ''}`}
              </button>
            </div>
          </div>

          {duplicateGroups.map((group, gi) => {
            const isSafe = group.tier === 'safe';
            return (
              <div key={gi} className={`card border ${isSafe ? 'border-zinc-200' : 'border-amber-200'}`}>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Group {gi + 1}</span>
                  <span className="text-xs text-zinc-400">·</span>
                  <span className="text-xs text-zinc-400">{group.variants.length} variants</span>
                  {isSafe ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                      <ShieldCheck className="w-3 h-3" strokeWidth={1.5} /> Safe
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      <AlertTriangle className="w-3 h-3" strokeWidth={1.5} /> Review
                    </span>
                  )}
                  {!isSafe && (
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={group.included}
                        onChange={() => handleGroupToggle(gi)}
                        className="accent-zinc-900"
                      />
                      Include in merge
                    </label>
                  )}
                </div>
                {!isSafe && (
                  <p className="text-xs text-amber-700 mb-3">
                    These names share a base payee but differ by extra details (e.g. ADVANCE, STAFF, INSTALMENT, date
                    prefixes) and may be separate payments. Only include if you're sure they're the same.
                  </p>
                )}
                <div className="space-y-1.5">
                  {group.variants.map((v) => {
                    const isSelected = group.selected === v.name;
                    const enabled = isSafe || group.included;
                    return (
                      <button
                        key={v.name}
                        onClick={() => enabled && handleGroupSelect(gi, v.name)}
                        disabled={!enabled}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                          !enabled
                            ? 'opacity-50 cursor-not-allowed'
                            : isSelected
                              ? 'bg-zinc-100 border border-zinc-300'
                              : 'border border-transparent hover:bg-zinc-50'
                        }`}
                      >
                        <Circle
                          className={`w-4 h-4 flex-shrink-0 ${!enabled ? 'text-zinc-300' : isSelected ? 'text-zinc-700 fill-zinc-700' : 'text-zinc-300'}`}
                          strokeWidth={1.5}
                        />
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm ${isSelected && enabled ? 'text-zinc-900 font-medium' : 'text-zinc-600'}`}>
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
            );
          })}
        </div>
      )}

      {/* Year filter + report controls */}
      {(allYears.length > 0 || statements.length > 0) && (
        <div className="card mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-32">
              <label className="label">Year</label>
              <Select
                value={year}
                onChange={(v) => { setYear(v); setSelected(new Set()); setMergeTarget(null); }}
                placeholder="All years"
                options={[{ value: '', label: 'All years' }, ...allYears.map(y => ({ value: String(y), label: String(y) }))]}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleExportCSV}
                disabled={!filtered.length}
                className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export payee totals to CSV"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                Export CSV
              </button>
              <button
                onClick={handlePrintReport}
                disabled={!filtered.length}
                className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Print payee annual report"
              >
                <Printer className="w-3.5 h-3.5" strokeWidth={1.5} />
                Print Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs: Yearly Summary / Payees */}
      {payees.length > 0 && (
        <div className="mb-6 inline-flex items-center gap-1 p-1 bg-zinc-100 border border-zinc-200 rounded-lg">
          <button
            onClick={() => setView('payees')}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'payees' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
            Payees
            <span className={`text-[10px] tabular-nums ${view === 'payees' ? 'text-zinc-300' : 'text-zinc-400'}`}>{payees.length}</span>
          </button>
          <button
            onClick={() => setView('summary')}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'summary' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Yearly Summary
            {filtered.length > 0 && (
              <span className={`text-[10px] tabular-nums ${view === 'summary' ? 'text-zinc-300' : 'text-zinc-400'}`}>{filtered.length}</span>
            )}
          </button>
        </div>
      )}

      {/* Yearly summary — total payments out per payee for the selected year */}
      {view === 'summary' && filtered.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-700">
              Yearly Summary{year ? ` — ${year}` : ''}
            </h2>
            <span className="text-xs text-zinc-400">Payments out · {filtered.length} payee{filtered.length > 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5">
            {[...filtered]
              .sort((a, b) => (Number(b.total_debit) || 0) - (Number(a.total_debit) || 0))
              .map(p => (
                <div key={p.payee} className="flex items-baseline justify-between gap-3 text-sm min-w-0">
                  <span className="text-zinc-700 truncate">{p.payee}</span>
                  <span className="text-zinc-900 font-medium tabular-nums whitespace-nowrap">{formatCurrency(p.total_debit)}</span>
                </div>
              ))}
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-200 flex items-baseline justify-between text-sm">
            <span className="font-medium text-zinc-900">Total</span>
            <span className="font-semibold text-zinc-900 tabular-nums">
              {formatCurrency(filtered.reduce((s, p) => s + (Number(p.total_debit) || 0), 0))}
            </span>
          </div>
        </div>
      )}

      {/* Toolbar: Search + Merge */}
      {view === 'payees' && payees.length > 0 && (
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
            {!bulkEditMode && (
              <button
                onClick={enterBulkEdit}
                className="border border-zinc-300 bg-transparent text-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
                title="Edit all payee names at once"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                Edit All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Payees list */}
      {view === 'payees' && (payees.length === 0 ? (
        <EmptyState
          icon={Users}
          title={year ? `No payees in ${year}` : 'No payees yet'}
          description={year
            ? 'No transactions with a payee were found for this year. Try another year or "All years".'
            : 'Payee names will appear here once you extract transactions from bank statements.'}
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
                    Debit (RM)
                  </th>
                  <th className="text-right text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    Credit (RM)
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
                        <span className="text-sm text-zinc-700 tabular-nums">{formatCurrency(p.total_debit)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm text-emerald-600 tabular-nums">{formatCurrency(p.total_credit)}</span>
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
      ))}

      {/* Floating action bar — merge (2+ selected) / bulk edit save */}
      {(selected.size >= 2 || bulkEditMode) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 no-print bg-white border border-zinc-200 rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          {bulkEditMode ? (
            <>
              <span className="text-xs text-zinc-500">Editing payee names</span>
              <div className="w-px h-4 bg-zinc-200" />
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
            </>
          ) : (
            <>
              <span className="text-xs text-zinc-600 font-medium tabular-nums">
                {selectedList.length} selected
              </span>
              <button
                onClick={() => { setSelected(new Set()); setMergeTarget(null); }}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
                title="Clear selection"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
              <div className="w-px h-4 bg-zinc-200" />
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
                    className="bg-zinc-800 text-white rounded-lg px-3 py-1 text-xs font-medium hover:bg-zinc-700 transition-colors"
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
            </>
          )}
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
