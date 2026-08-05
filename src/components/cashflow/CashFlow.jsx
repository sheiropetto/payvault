import { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Download, Printer, Search, Wallet, Receipt, CalendarRange, Crown, ChevronUp, ChevronDown
} from 'lucide-react';
import { api } from '../../utils/api';
import { formatCurrency } from '../../utils/format';
import { useCompany } from '../../contexts/CompanyContext';
import LoadingSpinner from '../ui/LoadingSpinner';
import EmptyState from '../ui/EmptyState';
import Select from '../ui/Select';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCompact(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(num >= 100_000 ? 0 : 1)}K`;
  return `${Math.round(num)}`;
}

// Shared page for the "Money In" (credits) and "Money Out" (debits) views.
// direction = 'in' | 'out'
export default function CashFlow({ direction }) {
  const isIn = direction === 'in';
  const { selectedCompanyId, selectedCompany } = useCompany();

  const [statements, setStatements] = useState([]);
  const [year, setYear] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [showAllPayees, setShowAllPayees] = useState(false);

  const yearTouched = useRef(false);
  const yearRef = useRef('');

  const allYears = useMemo(() => {
    return [...new Set(statements.map(s => s.year).filter(Boolean))].sort((a, b) => b - a);
  }, [statements]);

  useEffect(() => { yearRef.current = year; }, [year]);

  useEffect(() => {
    if (selectedCompanyId) {
      yearTouched.current = false;
      setYear('');
      setStatements([]);
      api.getStatements(selectedCompanyId)
        .then(d => setStatements(d || []))
        .catch(() => setStatements([]));
    }
  }, [selectedCompanyId]);

  // Auto-default to the latest available year (one-time per company)
  useEffect(() => {
    if (allYears.length > 0 && !yearTouched.current && !year) {
      setYear(String(allYears[0]));
    }
  }, [allYears, year]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    setLoading(true);
    const reqYear = yearRef.current;
    api.getCashflow(selectedCompanyId, reqYear)
      .then(d => { if (!cancelled && reqYear === yearRef.current) setData(d); })
      .catch(err => console.error(err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCompanyId, year]);

  // ── KPIs ──
  const summary = data?.summary || {};
  const total = isIn ? (Number(summary.total_credit) || 0) : (Number(summary.total_debit) || 0);
  const count = isIn ? (summary.cr_count || 0) : (summary.dr_count || 0);
  const monthlyAvg = year
    ? total / 12
    : (data?.by_year?.length ? total / data.by_year.length : 0);

  const topCounterparty = useMemo(() => {
    const payees = data?.by_payee || [];
    let best = null;
    for (const p of payees) {
      const val = isIn ? (Number(p.credit) || 0) : (Number(p.debit) || 0);
      if (val > 0 && (!best || val > best.value)) best = { name: p.payee, value: val };
    }
    return best;
  }, [data, isIn]);

  const kpis = [
    {
      label: isIn ? 'Total Money In' : 'Total Money Out',
      value: formatCurrency(total),
      icon: isIn ? TrendingUp : TrendingDown,
      color: isIn ? 'text-emerald-600' : 'text-violet-600',
      bg: isIn ? 'bg-emerald-100' : 'bg-violet-100',
    },
    {
      label: isIn ? 'Credits' : 'Payments',
      value: count.toLocaleString(),
      icon: Receipt,
      color: 'text-zinc-900',
      bg: 'bg-zinc-100',
    },
    {
      label: year ? 'Monthly Average' : 'Yearly Average',
      value: formatCurrency(monthlyAvg),
      icon: CalendarRange,
      color: 'text-blue-600',
      bg: 'bg-blue-100',
    },
    {
      label: isIn ? 'Top Source' : 'Top Payee',
      value: topCounterparty?.name ? topCounterparty.name : '—',
      sub: topCounterparty ? formatCurrency(topCounterparty.value) : null,
      icon: Crown,
      color: 'text-amber-600',
      bg: 'bg-amber-100',
    },
  ];

  // ── Monthly / yearly bars ──
  const bars = useMemo(() => {
    if (year) {
      const map = {};
      for (const m of (data?.by_month || [])) map[m.month] = Number(isIn ? m.credit : m.debit) || 0;
      return MONTH_NAMES.map((label, i) => ({ label, value: map[i + 1] || 0 }));
    }
    return (data?.by_year || []).map(y => ({ label: String(y.year), value: Number(isIn ? y.credit : y.debit) || 0 }));
  }, [data, year, isIn]);

  const maxBar = Math.max(1, ...bars.map(b => b.value));

  // ── Category breakdown ──
  const categories = useMemo(() => {
    const cats = (data?.by_category || [])
      .map(c => ({
        name: c.category || 'Other',
        value: Number(isIn ? c.credit : c.debit) || 0,
        count: c.tx_count || 0,
      }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);
    return cats;
  }, [data, isIn]);
  const maxCat = Math.max(1, ...categories.map(c => c.value));

  // ── Top payees (by direction) ──
  const topPayees = useMemo(() => {
    return (data?.by_payee || [])
      .map(p => ({ name: p.payee, value: Number(isIn ? p.credit : p.debit) || 0 }))
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data, isIn]);
  const maxPayee = Math.max(1, ...topPayees.map(p => p.value));
  // Show top 10 by default; expand to reveal every payee (top to least).
  const visibleTopPayees = showAllPayees ? topPayees : topPayees.slice(0, 10);

  // ── Drill-down table ──
  const rows = useMemo(() => {
    return (data?.transactions || []).filter(tx => isIn ? (tx.credit_amount > 0) : (tx.debit_amount > 0));
  }, [data, isIn]);

  const filteredRows = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(tx =>
        (tx.description || '').toLowerCase().includes(q) ||
        (tx.payee || '').toLowerCase().includes(q) ||
        (tx.category || '').toLowerCase().includes(q)
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => {
      if (sortField === 'amount') {
        const amtA = Number(isIn ? a.credit_amount : a.debit_amount) || 0;
        const amtB = Number(isIn ? b.credit_amount : b.debit_amount) || 0;
        return (amtA - amtB) * dir;
      }
      if (sortField === 'payee') return ((a.payee || '').localeCompare(b.payee || '')) * dir;
      if (sortField === 'category') return ((a.category || '').localeCompare(b.category || '')) * dir;
      return ((a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : 0) * dir;
    });
  }, [rows, search, sortField, sortDir, isIn]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'payee' || field === 'category' ? 'asc' : 'desc');
    }
  }

  // ── Export CSV ──
  function handleExportCSV() {
    if (!filteredRows.length) return;
    const headers = ['Date', 'Description', 'Particulars', 'Payee', 'Category', 'Debit (RM)', 'Credit (RM)', 'Statement'];
    const lines = [headers.join(',')];
    lines.push(`TOTAL ${isIn ? 'MONEY IN' : 'MONEY OUT'},${filteredRows.length} rows,,${formatCurrency(total)},,,,`);
    for (const tx of filteredRows) {
      lines.push([
        tx.date || '',
        `"${(tx.description || '').replace(/"/g, '""')}"`,
        `"${(tx.particulars || '').replace(/"/g, '""')}"`,
        `"${(tx.payee || '').replace(/"/g, '""')}"`,
        `"${(tx.category || '').replace(/"/g, '""')}"`,
        (Number(tx.debit_amount) || 0).toFixed(2),
        (Number(tx.credit_amount) || 0).toFixed(2),
        `"${(tx.statement || '').replace(/"/g, '""')}"`,
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `money-${isIn ? 'in' : 'out'}${year ? `-${year}` : '-all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Print report (standalone window, like the vouchers report) ──
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function printHTML(html, docTitle) {
    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${esc(docTitle || `${title} Report`)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body { font-family: 'Inter', system-ui, sans-serif; color: #18181b; margin: 0; font-size: 14px; }
          .report-head { text-align: center; margin-bottom: 22px; }
          .report-head h1 { font-size: 26px; font-weight: 700; margin: 0 0 6px; }
          .report-head p { font-size: 14px; color: #52525b; margin: 3px 0; }
          .summary-cards { display: flex; flex-wrap: wrap; gap: 12px; }
          .summary-card { flex: 1 1 42%; border: 1px solid #d4d4d8; border-radius: 10px; padding: 14px 16px; }
          .summary-card .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #52525b; }
          .summary-card .val { font-size: 19px; font-weight: 700; margin-top: 6px; }
          .summary-card .sub { font-size: 12px; color: #71717a; margin-top: 4px; word-break: break-word; }
          .chart { display: block; width: 100%; max-width: 760px; margin: 4px auto 2px; }
          .report-section { margin-top: 20px; }
          .report-section h2 { font-size: 17px; font-weight: 700; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 2px solid #d4d4d8; }
          .keep { page-break-inside: avoid; }
          .page-break { break-before: page; page-break-before: always; }
          .sources { display: grid; grid-template-columns: 1fr; row-gap: 5px; }
          .source-row { display: flex; align-items: center; gap: 10px; padding: 2px 0; }
          .source-row .rank { width: 16px; flex-shrink: 0; text-align: right; font-size: 11px; color: #a1a1aa; font-variant-numeric: tabular-nums; }
          .source-main { flex: 1; min-width: 0; }
          .source-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 3px; }
          .source-name { color: #27272a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
          .source-val { color: #52525b; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; flex-shrink: 0; }
          .source-bar { height: 5px; background: #f4f4f5; border-radius: 999px; overflow: hidden; }
          .source-fill { height: 100%; border-radius: 999px; opacity: 0.75; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          thead { display: table-header-group; }
          th { text-align: left; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; color: #52525b; padding: 6px 10px; border-bottom: 1px solid #d4d4d8; background: #fafafa; }
          td { padding: 6px 10px; border-bottom: 1px solid #ececee; vertical-align: top; }
          .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .nowrap { white-space: nowrap; }
          .strong { font-weight: 600; }
          tr.total td { font-weight: 600; border-top: 2px solid #d4d4d8; background: #fafafa; }
          .muted { color: #71717a; }
          .no-print { text-align: center; padding: 20px; }
          .no-print button { padding: 10px 30px; font-size: 14px; cursor: pointer; background: #18181b; color: #fff; border: none; border-radius: 8px; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        ${html}
        <div class="no-print">
          <button onclick="window.print()">Print / Save PDF</button>
        </div>
      </body>
      </html>
    `);
    win.document.close();
  }

  function handlePrintReport() {
    if (!filteredRows.length) return;
    const companyName = selectedCompany?.name || 'Company';
    const yearLabel = year ? String(year) : 'All Years';
    const directionLabel = isIn ? 'Money In' : 'Money Out';
    const amountLabel = isIn ? 'Credit (RM)' : 'Debit (RM)';

    // Monthly (or yearly) period breakdown
    let periodRows = '';
    if (year) {
      const map = {};
      for (const m of (data?.by_month || [])) map[m.month] = Number(isIn ? m.credit : m.debit) || 0;
      periodRows = MONTH_NAMES.map((mn, i) =>
        `<tr><td>${mn}</td><td class="num">${map[i + 1] ? formatCurrency(map[i + 1]) : ''}</td></tr>`
      ).join('');
      periodRows += `<tr class="total"><td>Total (${yearLabel})</td><td class="num strong">${formatCurrency(total)}</td></tr>`;
    } else {
      periodRows = (data?.by_year || [])
        .map(y => `<tr><td>${esc(String(y.year))}</td><td class="num">${formatCurrency(Number(isIn ? y.credit : y.debit) || 0)}</td></tr>`)
        .join('');
      if ((data?.by_year || []).length) {
        periodRows += `<tr class="total"><td>Total (all years)</td><td class="num strong">${formatCurrency(total)}</td></tr>`;
      }
    }

    // ── Monthly (or yearly) bar chart (graphical) ──
    function barChartSVG() {
      const W = 760, H = 240;
      const padT = 32, padR = 8, padB = 46, padL = 8;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      const n = bars.length;
      const slot = plotW / n;
      const barW = Math.max(12, Math.min(44, slot * 0.6));
      const maxV = Math.max(1, ...bars.map(b => b.value));
      const color = isIn ? '#10b981' : '#27272a';
      const body = bars.map((b, i) => {
        const x = padL + slot * i + (slot - barW) / 2;
        const h = (b.value / maxV) * plotH;
        const y = padT + (plotH - h);
        let s = '';
        if (b.value > 0) {
          s += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#52525b">${formatCompact(b.value)}</text>`;
        }
        s += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(0, h)}" rx="3" fill="${color}" />`;
        s += `<text x="${x + barW / 2}" y="${padT + plotH + 22}" text-anchor="middle" font-size="11" fill="#52525b">${b.label}</text>`;
        return s;
      }).join('');
      return `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
    }
    const chartHTML = barChartSVG();

    // ── Graphical sources / payees (ranked list with thin bars) ──
    const reportPayees = topPayees;
    const maxSource = Math.max(1, ...reportPayees.map(p => p.value));
    const barColor = isIn ? '#10b981' : '#27272a';
    const sourceRows = reportPayees.map((p, i) => `
      <div class="source-row">
        <span class="rank">${i + 1}</span>
        <div class="source-main">
          <div class="source-top">
            <span class="source-name">${esc(p.name)}</span>
            <span class="source-val">${formatCurrency(p.value)}</span>
          </div>
          <div class="source-bar"><div class="source-fill" style="width:${(p.value / maxSource) * 100}%;background:${barColor}"></div></div>
        </div>
      </div>`).join('');

    // Categories
    const catRows = categories.map(c =>
      `<tr><td>${esc(c.name)}</td><td class="num">${c.count}</td><td class="num">${formatCurrency(c.value)}</td><td class="num">${maxCat ? ((c.value / maxCat) * 100).toFixed(1) : '0.0'}%</td></tr>`
    ).join('');

    const html = `
      <div class="report-head">
        <h1>${directionLabel} Report — ${esc(companyName)}</h1>
        <p>Year: ${esc(yearLabel)} &nbsp;·&nbsp; Generated: ${esc(new Date().toLocaleString('en-MY'))}</p>
      </div>

      <div class="summary-cards keep">
        <div class="summary-card"><div class="lbl">Total ${directionLabel}</div><div class="val">${formatCurrency(total)}</div></div>
        <div class="summary-card"><div class="lbl">${isIn ? 'Credits' : 'Payments'}</div><div class="val">${count.toLocaleString()}</div></div>
        <div class="summary-card"><div class="lbl">${year ? 'Monthly' : 'Yearly'} Average</div><div class="val">${formatCurrency(monthlyAvg)}</div><div class="sub">per ${year ? 'month' : 'year'}</div></div>
        <div class="summary-card"><div class="lbl">${isIn ? 'Top Source' : 'Top Payee'}</div><div class="val">${esc(topCounterparty?.name || '—')}</div><div class="sub">${topCounterparty ? formatCurrency(topCounterparty.value) : ''}</div></div>
      </div>

      <div class="report-section keep">
        <h2>${year ? `Monthly ${directionLabel} — ${yearLabel}` : `${directionLabel} by Year`}</h2>
        ${chartHTML}
        <table>
          <thead><tr><th>${year ? 'Month' : 'Year'}</th><th class="num">${amountLabel}</th></tr></thead>
          <tbody>${periodRows}</tbody>
        </table>
      </div>

      ${sourceRows ? `
      <div class="report-section page-break">
        <h2>${isIn ? 'All Sources' : 'All Payees'} (${reportPayees.length})</h2>
        <div class="sources">${sourceRows}</div>
      </div>` : ''}

      ${catRows ? `
      <div class="report-section keep">
        <h2>Category Breakdown</h2>
        <table>
          <thead><tr><th>Category</th><th class="num">Txns</th><th class="num">${amountLabel}</th><th class="num">% of Total</th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>` : ''}`;

    printHTML(html, `${directionLabel} Report ${yearLabel}`);
  }

  if (loading) return <LoadingSpinner />;

  const title = isIn ? 'Money In' : 'Money Out';
  const subtitle = isIn
    ? 'Cash coming into the account (credits / deposits)'
    : 'Cash going out of the account (debits / payments)';

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 no-print">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-2">
            {isIn ? <TrendingUp className="w-5 h-5 text-emerald-600" strokeWidth={1.5} /> : <TrendingDown className="w-5 h-5 text-violet-600" strokeWidth={1.5} />}
            {title}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="w-36">
            <label className="label">Year</label>
            <Select
              value={year}
              onChange={(v) => { yearTouched.current = true; setYear(v); }}
              options={[
                { value: '', label: 'All years' },
                ...allYears.map(y => ({ value: String(y), label: String(y) })),
              ]}
            />
          </div>
          <div>
            <label className="label">&nbsp;</label>
            <div className="flex gap-2">
              <button
                className="btn-ghost text-xs flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-50"
                onClick={handleExportCSV}
                disabled={!filteredRows.length}
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                Export CSV
              </button>
              <button
                className="btn-ghost text-xs flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-50"
                onClick={handlePrintReport}
                disabled={!filteredRows.length}
              >
                <Printer className="w-3.5 h-3.5" strokeWidth={1.5} />
                Print
              </button>
            </div>
          </div>
        </div>
      </div>

      {!selectedCompanyId ? (
        <EmptyState
          icon={isIn ? TrendingUp : TrendingDown}
          title="Select a company"
          description="Choose a company from the sidebar to view its money flow."
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon={isIn ? TrendingUp : TrendingDown}
          title={`No ${isIn ? 'money in' : 'money out'} recorded`}
          description={`No ${isIn ? 'credit' : 'debit'} transactions found${year ? ` for ${year}` : ''}.`}
        />
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="bg-white border border-zinc-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${kpi.bg}`}>
                    <kpi.icon className={`w-4 h-4 ${kpi.color}`} strokeWidth={1.5} />
                  </div>
                  <span className="text-xs font-medium text-zinc-500">{kpi.label}</span>
                </div>
                <div className="text-lg font-semibold text-zinc-900 leading-tight break-words">{kpi.value}</div>
                {kpi.sub && <div className="text-xs text-zinc-500 mt-1">{kpi.sub}</div>}
              </div>
            ))}
          </div>

          {/* Chart + category */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  {year ? `Monthly ${isIn ? 'Money In' : 'Money Out'} — ${year}` : `${isIn ? 'Money In' : 'Money Out'} by Year`}
                </h2>
                <span className="text-xs text-zinc-400">{formatCurrency(total)}</span>
              </div>
              <div className="flex items-end gap-1.5 h-40">
                {bars.map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                    <span className="text-[10px] text-zinc-400 mb-1 tabular-nums">{b.value > 0 ? formatCompact(b.value) : ''}</span>
                    <div
                      className={`w-full rounded-t ${isIn ? 'bg-emerald-500/80' : 'bg-zinc-900/85'}`}
                      style={{ height: `${(b.value / maxBar) * 100}%`, minHeight: b.value > 0 ? 3 : 0 }}
                    />
                    <span className="text-[10px] text-zinc-400 mt-1.5 truncate w-full text-center">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-zinc-900 mb-4">By Category</h2>
              {categories.length === 0 ? (
                <p className="text-sm text-zinc-400">No data</p>
              ) : (
                <div className="space-y-3">
                  {categories.map((c) => (
                    <div key={c.name}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-zinc-700 truncate">{c.name}</span>
                        <span className="text-zinc-500 font-medium tabular-nums">{formatCurrency(c.value)}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${isIn ? 'bg-emerald-500/70' : 'bg-zinc-900/70'}`} style={{ width: `${(c.value / maxCat) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top payees */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">
                Top {isIn ? 'Sources' : 'Payees'}
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  {showAllPayees ? topPayees.length : `${Math.min(10, topPayees.length)} of ${topPayees.length}`}
                </span>
              </h2>
              {topPayees.length > 10 && (
                <button
                  onClick={() => setShowAllPayees(v => !v)}
                  className="text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-zinc-300 bg-transparent rounded-lg px-3 py-1.5 hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
                >
                  {showAllPayees ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Show all ({topPayees.length})
                    </>
                  )}
                </button>
              )}
            </div>
            {visibleTopPayees.length === 0 ? (
              <p className="text-sm text-zinc-400">No data</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                {visibleTopPayees.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="w-5 text-xs text-zinc-400 tabular-nums text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-xs mb-1 gap-2">
                        <span className="text-zinc-700 truncate">{p.name}</span>
                        <span className="text-zinc-500 font-medium tabular-nums shrink-0">{formatCurrency(p.value)}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${isIn ? 'bg-emerald-500/70' : 'bg-zinc-900/70'}`} style={{ width: `${(p.value / maxPayee) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drill-down table */}
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-zinc-100">
              <h2 className="text-sm font-semibold text-zinc-900">Transactions</h2>
              <div className="relative w-64 max-w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                <input
                  className="input pl-9"
                  placeholder="Search description, payee..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                    <th className="px-4 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort('date')}>
                      Date {sortField === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="px-4 py-2.5 font-medium">Description</th>
                    <th className="px-4 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort('payee')}>
                      Payee {sortField === 'payee' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="px-4 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort('category')}>
                      Category {sortField === 'category' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="px-4 py-2.5 font-medium cursor-pointer select-none text-right" onClick={() => toggleSort('amount')}>
                      {isIn ? 'Credit' : 'Debit'} {sortField === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((tx) => (
                    <tr key={tx.id} className="border-b border-zinc-50 hover:bg-zinc-50/60">
                      <td className="px-4 py-2 text-zinc-500 whitespace-nowrap tabular-nums">{tx.date}</td>
                      <td className="px-4 py-2 text-zinc-700 max-w-md truncate" title={tx.description}>{tx.description}</td>
                      <td className="px-4 py-2 text-zinc-700">{tx.payee || '—'}</td>
                      <td className="px-4 py-2 text-zinc-500">{tx.category || '—'}</td>
                      <td className={`px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap ${isIn ? 'text-emerald-600' : 'text-zinc-900'}`}>
                        {formatCurrency(isIn ? tx.credit_amount : tx.debit_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-zinc-100 text-xs text-zinc-500 flex items-center justify-between">
              <span>{filteredRows.length} transaction{filteredRows.length !== 1 ? 's' : ''}</span>
              <span>
                {isIn ? 'Money In' : 'Money Out'}: <span className="font-medium text-zinc-900">{formatCurrency(total)}</span>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
