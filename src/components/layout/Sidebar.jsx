import { useState, useRef, useEffect } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Upload, Table2, FileText, Building2,
  Palette, Settings, ChevronLeft, ChevronRight, Vault,
  Plus, Check, ChevronDown, Users
} from 'lucide-react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { useCompany } from '../../contexts/CompanyContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/bank-statements', icon: Upload, label: 'Bank Statements' },
  { to: '/transactions', icon: Table2, label: 'Transactions' },
  { to: '/vouchers', icon: FileText, label: 'Payment Vouchers' },
  { to: '/companies', icon: Building2, label: 'Companies' },
  { to: '/templates', icon: Palette, label: 'Templates' },
  { to: '/payees', icon: Users, label: 'Payees' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const [companyOpen, setCompanyOpen] = useState(false);
  const navigate = useNavigate();
  const dropdownRef = useRef(null);
  const { companies, selectedCompany, selectedCompanyId, switchCompany } = useCompany();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setCompanyOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  const { signOut } = useClerk();
  const { user } = useUser();

  return (
    <aside
      className={`no-print fixed left-0 top-0 h-screen bg-white border-r border-zinc-200
        flex flex-col transition-all duration-200 z-40
        ${collapsed ? 'w-16' : 'w-56'}`}
    >
      {/* Logo */}
      <div className={`flex items-center h-14 px-4 border-b border-zinc-200 ${collapsed ? 'justify-center' : 'gap-3'}`}>
        <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center shrink-0">
          <Vault className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-sm tracking-tight">PayVault</span>
        )}
      </div>

      {/* Company Switcher */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-zinc-200 relative" ref={dropdownRef}>
          <button
            onClick={() => setCompanyOpen(!companyOpen)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
              hover:bg-zinc-100 transition-colors text-left"
          >
            <div className="w-5 h-5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
              <Building2 className="w-3 h-3 text-zinc-500" strokeWidth={1.5} />
            </div>
            <span className="text-xs font-medium text-zinc-700 truncate flex-1">
              {selectedCompany?.name || 'Select company'}
            </span>
            <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${companyOpen ? 'rotate-180' : ''}`} strokeWidth={1.5} />
          </button>

          {companyOpen && (
            <div className="absolute left-3 right-3 mt-1 py-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-50">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { switchCompany(c.id); setCompanyOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left
                    hover:bg-zinc-50 transition-colors
                    ${c.id === selectedCompanyId ? 'text-zinc-900 font-medium' : 'text-zinc-600'}`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.id === selectedCompanyId ? 'bg-zinc-900' : 'bg-zinc-300'}`} />
                  <span className="truncate flex-1">{c.name}</span>
                  {c.id === selectedCompanyId && (
                    <Check className="w-3 h-3 text-zinc-900" strokeWidth={2} />
                  )}
                </button>
              ))}
              <div className="border-t border-zinc-100 mt-1 pt-1">
                <button
                  onClick={() => { setCompanyOpen(false); navigate('/companies'); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500
                    hover:bg-zinc-50 transition-colors"
                >
                  <Plus className="w-3 h-3" strokeWidth={1.5} />
                  Add company
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className={`flex-1 py-3 px-2 space-y-1 ${collapsed ? 'overflow-visible' : 'overflow-y-auto'}`}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar-link relative group ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-2' : ''}`
            }
          >
            <item.icon className="w-4.5 h-4.5 shrink-0" strokeWidth={1.5} />
            {!collapsed ? (
              <span>{item.label}</span>
            ) : (
              <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 bg-zinc-900 text-white text-[11px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50 shadow-md">
                {item.label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-10 mx-2 mb-2 rounded-lg
          text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* User */}
      {!collapsed && user && (
        <div className="border-t border-zinc-200 px-4 py-3">
          <p className="text-xs text-zinc-500 truncate">{user.primaryEmailAddress?.emailAddress}</p>
          <button
            onClick={() => signOut()}
            className="text-xs text-zinc-400 hover:text-zinc-600 mt-1"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
