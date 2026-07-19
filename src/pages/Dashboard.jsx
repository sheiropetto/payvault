import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, FileText, Building2, DollarSign
} from 'lucide-react';
import { api } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { useCompany } from '../contexts/CompanyContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Select from '../components/ui/Select';
import Icon from '../utils/icons';

export default function Dashboard() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (selectedCompanyId) loadData();
  }, [selectedCompanyId]);

  async function loadData() {
    try {
      const [vouchers, statements] = await Promise.all([
        api.getVouchers(selectedCompanyId),
        api.getStatements(selectedCompanyId),
      ]);
      setData({ vouchers, statements });
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchVouchers(selectedCompanyId, searchQuery.trim());
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCompanyId]);

  const years = useMemo(() => {
    const ys = new Set();
    (data?.vouchers || []).forEach(v => {
      if (v.date) ys.add(v.date.slice(0, 4));
    });
    return [...ys].sort((a, b) => b - a);
  }, [data]);

  const filteredVouchers = useMemo(() => {
    const vouchers = data?.vouchers || [];
    if (!year) return vouchers;
    return vouchers.filter(v => v.date?.startsWith(year));
  }, [data, year]);

  const statusBadge = useCallback((status) => {
    const map = {
      draft: 'bg-zinc-100 text-zinc-600',
      approved: 'bg-blue-100 text-blue-700',
      paid: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-red-100 text-red-600',
    };
    return `inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-zinc-100 text-zinc-600'}`;
  }, []);

  if (loading) return <LoadingSpinner />;

  const totalSpent = filteredVouchers
    .filter(v => v.status !== 'cancelled')
    .reduce((sum, v) => sum + v.amount, 0);

  const stats = [
    {
      label: selectedCompany?.name || 'Company',
      value: selectedCompany?.name || '—',
      icon: Building2,
      color: 'text-zinc-900',
      bg: 'bg-zinc-100',
      link: '/companies',
    },
    {
      label: 'Statements',
      value: data?.statements?.length || 0,
      icon: Upload,
      color: 'text-blue-600',
      bg: 'bg-blue-100',
      link: '/bank-statements',
    },
    {
      label: 'Vouchers',
      value: data?.vouchers?.length || 0,
      icon: FileText,
      color: 'text-emerald-600',
      bg: 'bg-emerald-100',
      link: '/vouchers',
    },
    {
      label: 'Total Disbursed',
      value: formatCurrency(totalSpent),
      icon: DollarSign,
      color: 'text-violet-600',
      bg: 'bg-violet-100',
      link: '/vouchers',
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">Overview of your payment operations</p>
        </div>
        {years.length > 0 && (
          <div className="w-24">
            <Select
              value={year}
              onChange={setYear}
              placeholder="All years"
              options={[
                { value: '', label: 'All' },
                ...years.map(y => ({ value: y, label: y })),
              ]}
            />
          </div>
        )}
      </div>

      {/* Master Search */}
      <div className="mb-6">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon size={16} className="text-zinc-400">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </Icon>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search vouchers by payee, voucher number, category, description…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-zinc-300 rounded-lg bg-white
                       placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 focus:border-zinc-400
                       transition-shadow"
          />
          {searching && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Search Results */}
        {searchResults !== null && (
          <div className="mt-3 card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-900">
                Search results
                <span className="text-zinc-400 font-normal ml-1">
                  · {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
                </span>
              </h2>
              <button
                onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                className="text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
              >
                Clear
              </button>
            </div>
            {searchResults.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">
                No vouchers match "{searchQuery}"
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      <th className="text-left py-2 pr-4 font-medium text-zinc-500 text-xs uppercase tracking-wider">Voucher</th>
                      <th className="text-left py-2 pr-4 font-medium text-zinc-500 text-xs uppercase tracking-wider">Payee</th>
                      <th className="text-left py-2 pr-4 font-medium text-zinc-500 text-xs uppercase tracking-wider">Date</th>
                      <th className="text-left py-2 pr-4 font-medium text-zinc-500 text-xs uppercase tracking-wider">Amount</th>
                      <th className="text-left py-2 pr-4 font-medium text-zinc-500 text-xs uppercase tracking-wider">Category</th>
                      <th className="text-left py-2 font-medium text-zinc-500 text-xs uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map(v => (
                      <tr key={v.id} className="border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors">
                        <td className="py-2.5 pr-4">
                          <Link to="/vouchers" className="text-zinc-900 font-medium hover:text-zinc-600 transition-colors">
                            {v.voucher_number}
                          </Link>
                          {v.company_name && (
                            <p className="text-xs text-zinc-400">{v.company_name}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-zinc-700">{v.payee || '—'}</td>
                        <td className="py-2.5 pr-4 text-zinc-500 whitespace-nowrap">{formatDate(v.date)}</td>
                        <td className="py-2.5 pr-4 font-medium text-zinc-900">{formatCurrency(v.amount)}</td>
                        <td className="py-2.5 pr-4 text-zinc-500">{v.category || '—'}</td>
                        <td className="py-2.5">
                          <span className={statusBadge(v.status)}>{v.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} to={stat.link} className="card hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} strokeWidth={1.5} />
              </div>
            </div>
            <p className="text-2xl font-semibold text-zinc-900">{stat.value}</p>
            <p className="text-xs text-zinc-500 mt-1">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">
            Recent Vouchers
            {year && <span className="text-zinc-400 font-normal ml-1">· {year}</span>}
          </h2>
          {filteredVouchers.length ? (
            <div className="space-y-3">
              {filteredVouchers.slice(0, 5).map((v) => (
                <div key={v.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{v.payee}</p>
                    <p className="text-xs text-zinc-500">{v.voucher_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-zinc-900">{formatCurrency(v.amount)}</p>
                    <span className={statusBadge(v.status)}>{v.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-400 text-center py-8">No vouchers yet</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link to="/bank-statements" className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors">
              <div className="p-2 rounded-lg bg-blue-100">
                <Upload className="w-4 h-4 text-blue-600" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">Upload Bank Statement</p>
                <p className="text-xs text-zinc-500">Import PDF or CSV to extract transactions</p>
              </div>
            </Link>
            <Link to="/vouchers" className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors">
              <div className="p-2 rounded-lg bg-emerald-100">
                <FileText className="w-4 h-4 text-emerald-600" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">Generate Payment Voucher</p>
                <p className="text-xs text-zinc-500">Create vouchers from transactions</p>
              </div>
            </Link>
            <Link to="/companies" className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors">
              <div className="p-2 rounded-lg bg-violet-100">
                <Building2 className="w-4 h-4 text-violet-600" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">Manage Companies</p>
                <p className="text-xs text-zinc-500">Add or edit company profiles</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
