-- PayVault Initial Schema
-- Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  logo_url TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  bank_name TEXT,
  bank_account TEXT,
  signature_name TEXT,
  signature_title TEXT,
  show_logo INTEGER DEFAULT 1,
  show_address INTEGER DEFAULT 1,
  show_phone INTEGER DEFAULT 0,
  show_email INTEGER DEFAULT 0,
  show_tax_id INTEGER DEFAULT 1,
  show_bank_details INTEGER DEFAULT 1,
  show_signature INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  layout_config TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK(file_type IN ('pdf', 'csv')),
  file_url TEXT NOT NULL,
  file_size INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','done','error')),
  month INTEGER,
  year INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bank_statement_id TEXT REFERENCES bank_statements(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  debit_amount REAL DEFAULT 0,
  credit_amount REAL DEFAULT 0,
  balance REAL,
  category TEXT,
  payee TEXT,
  is_edited INTEGER DEFAULT 0,
  is_vouchered INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_vouchers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id),
  voucher_number TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  invoice_ref TEXT,
  category TEXT,
  payment_method TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','approved','paid','cancelled')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voucher_transactions (
  voucher_id TEXT REFERENCES payment_vouchers(id) ON DELETE CASCADE,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (voucher_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  user_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS authorized_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','editor','viewer')),
  added_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed default admin
INSERT OR IGNORE INTO authorized_users (email, role, added_by) VALUES ('hafizuddin.abuhasan@gmail.com', 'admin', 'system');

-- Indexes
CREATE INDEX idx_transactions_statement ON transactions(bank_statement_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_vouchers_company ON payment_vouchers(company_id);
CREATE INDEX idx_vouchers_date ON payment_vouchers(date);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
