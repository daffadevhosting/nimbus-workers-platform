-- Initialize database
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT DEFAULT 'free',
  config TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS tenant_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER,
  execution_time INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Files table (if not exists)
CREATE TABLE IF NOT EXISTS tenant_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  file_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_tenant_files_tenant ON tenant_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_files_uploaded ON tenant_files(uploaded_at);

-- Insert sample tenant
INSERT OR IGNORE INTO tenants (id, name, plan) 
VALUES ('demo', 'Demo Tenant', 'free');