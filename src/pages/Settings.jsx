import { useUser } from '@clerk/clerk-react';
import { useState, useEffect } from 'react';
import { User, Bell, Shield, CreditCard, Users, Plus, Trash2 } from 'lucide-react';
import { api } from '../utils/api';
import Select from '../components/ui/Select';

const sections = [
  {
    id: 'profile',
    icon: User,
    title: 'Profile',
    description: 'Manage your account details',
    content: 'Your account is managed through Clerk. You can update your profile from the Clerk dashboard.',
  },
  {
    id: 'notifications',
    icon: Bell,
    title: 'Notifications',
    description: 'Configure email preferences',
    content: 'Notification settings coming soon.',
  },
  {
    id: 'security',
    icon: Shield,
    title: 'Security',
    description: 'Password and authentication',
    content: 'Security settings are managed through Clerk.',
  },
  {
    id: 'billing',
    icon: CreditCard,
    title: 'API & Usage',
    description: 'DeepSeek API key and usage',
    content: 'Configure your DeepSeek API key and monitor token usage.',
  },
];

export default function Settings() {
  const { user } = useUser();
  const [authUsers, setAuthUsers] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const currentEmail = user?.primaryEmailAddress?.emailAddress;
  const isAdmin = authUsers.find(u => u.email === currentEmail)?.role === 'admin';

  useEffect(() => {
    api.getAuthorizedUsers().then(setAuthUsers).catch(() => {});
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    setError('');
    try {
      const result = await api.addAuthorizedUser({ email: newEmail.trim(), role: newRole });
      setAuthUsers(prev => [...prev.filter(u => u.email !== result.email), result]);
      setNewEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(email) {
    try {
      await api.removeAuthorizedUser(email);
      setAuthUsers(prev => prev.filter(u => u.email !== email));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-900">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage your account and preferences</p>
      </div>

      {/* User info card */}
      <div className="card mb-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center text-sm font-medium text-zinc-600">
            {user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900">
              {user?.fullName || 'User'}
            </p>
            <p className="text-xs text-zinc-500">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </div>
      </div>

      {/* Authorized Users — admin only */}
      {isAdmin && (
        <div className="card mb-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-2 rounded-lg bg-zinc-100 shrink-0">
              <Users className="w-4.5 h-4.5 text-zinc-600" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-zinc-900">Authorized Users</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Manage who can access PayVault</p>
            </div>
          </div>

          {/* User list */}
          <div className="space-y-2 mb-4">
            {authUsers.map(u => (
              <div key={u.email} className="flex items-center justify-between py-2 px-3 bg-zinc-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-900">{u.email}</span>
                  <span className={`badge text-[10px] ${
                    u.role === 'admin' ? 'bg-zinc-900 text-white' :
                    u.role === 'editor' ? 'bg-zinc-200 text-zinc-700' :
                    'bg-zinc-100 text-zinc-500'
                  }`}>{u.role}</span>
                </div>
                {u.email !== currentEmail && (
                  <button
                    className="btn-ghost text-xs text-red-500 hover:text-red-600 p-1"
                    onClick={() => handleRemove(u.email)}
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add user form */}
          <form onSubmit={handleAdd} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                placeholder="colleague@example.com"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
              />
            </div>
            <div className="w-28">
              <label className="label">Role</label>
              <Select
                value={newRole}
                onChange={setNewRole}
                options={[
                  { value: 'editor', label: 'Editor' },
                  { value: 'viewer', label: 'Viewer' }
                ]}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={adding}>
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              {adding ? '...' : 'Add'}
            </button>
          </form>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}

      {/* Settings sections */}
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.id} className="card">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-zinc-100 shrink-0">
                <section.icon className="w-4.5 h-4.5 text-zinc-600" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-zinc-900">{section.title}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">{section.description}</p>
                <p className="text-xs text-zinc-400 mt-2">{section.content}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
