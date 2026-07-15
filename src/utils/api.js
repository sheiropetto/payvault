const BASE = '/api';

// User email — set by AuthBridge in main.jsx
let _userEmail = '';

export function setUserEmail(email) {
  _userEmail = email || '';
}

async function request(path, options = {}) {
  // If email not yet available, poll for up to 5s
  if (!_userEmail) {
    for (let i = 0; i < 10 && !_userEmail; i++) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const headers = { ...options.headers };
  if (_userEmail) headers['X-User-Email'] = _userEmail;

  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Companies
  getCompanies: () => request('/companies'),
  getCompany: (id) => request(`/companies/${id}`),
  createCompany: (data) => request('/companies', { method: 'POST', body: JSON.stringify(data) }),
  updateCompany: (id, data) => request(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCompany: (id) => request(`/companies/${id}`, { method: 'DELETE' }),

  // Bank Statements
  getStatements: (companyId) => request(`/bank-statements${companyId ? `?company_id=${companyId}` : ''}`),
  getStatement: (id) => request(`/bank-statements/${id}`),
  uploadStatement: async (file, companyId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('company_id', companyId);
    const headers = {};
    if (_userEmail) headers['X-User-Email'] = _userEmail;
    const res = await fetch(`${BASE}/bank-statements`, { method: 'POST', headers, body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
  deleteStatement: (id) => request(`/bank-statements/${id}`, { method: 'DELETE' }),

  // Transactions
  getTransactions: (statementId) => request(`/transactions?statement_id=${statementId}`),
  updateTransactions: (updates) => request('/transactions', {
    method: 'PATCH', body: JSON.stringify({ updates }),
  }),

  // DeepSeek
  extractTransactions: (statementId, text = '') => request('/deepseek/extract', {
    method: 'POST', body: JSON.stringify({ statement_id: statementId, text }),
  }),

  // Vouchers
  getVouchers: (companyId) => request(`/vouchers${companyId ? `?company_id=${companyId}` : ''}`),
  getVoucher: (id) => request(`/vouchers/${id}`),
  createVoucher: (data) => request('/vouchers', { method: 'POST', body: JSON.stringify(data) }),
  updateVoucher: (id, data) => request(`/vouchers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteVoucher: (id) => request(`/vouchers/${id}`, { method: 'DELETE' }),

  // Templates
  getTemplates: (companyId) => request(`/templates${companyId ? `?company_id=${companyId}` : ''}`),
  createTemplate: (data) => request('/templates', { method: 'POST', body: JSON.stringify(data) }),

  // Authorized Users
  getAuthorizedUsers: () => request('/auth/users'),
  addAuthorizedUser: (data) => request('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  removeAuthorizedUser: (email) => request(`/auth/users?email=${encodeURIComponent(email)}`, { method: 'DELETE' }),
};
