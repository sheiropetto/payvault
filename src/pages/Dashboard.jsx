import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, FileText, Building2, DollarSign
} from 'lucide-react';
import { api } from '../utils/api';
import { formatCurrency } from '../utils/format';
import { useCompany } from '../contexts/CompanyContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';

export default function Dashboard() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <LoadingSpinner />;

  const totalSpent = (data?.vouchers || [])
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
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-900">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Overview of your payment operations</p>
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
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Recent Vouchers</h2>
          {data?.vouchers?.length ? (
            <div className="space-y-3">
              {data.vouchers.slice(0, 5).map((v) => (
                <div key={v.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{v.payee}</p>
                    <p className="text-xs text-zinc-500">{v.voucher_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-zinc-900">{formatCurrency(v.amount)}</p>
                    <span className={`badge-${v.status}`}>{v.status}</span>
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
