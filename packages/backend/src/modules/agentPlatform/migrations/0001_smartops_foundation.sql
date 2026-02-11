BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS smartops;

CREATE OR REPLACE FUNCTION smartops.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS smartops.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL UNIQUE,
  org_code VARCHAR(128) NOT NULL UNIQUE,
  license_tier VARCHAR(32) NOT NULL CHECK (license_tier IN ('standard', 'enterprise')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_tenants_updated_at
BEFORE UPDATE ON smartops.tenants
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  keycloak_sub VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  role VARCHAR(32) NOT NULL CHECK (role IN ('admin', 'developer', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, keycloak_sub)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON smartops.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_keycloak_sub ON smartops.users(keycloak_sub);

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON smartops.users
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.org_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  parent_id UUID REFERENCES smartops.org_units(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_org_units_updated_at
BEFORE UPDATE ON smartops.org_units
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  org_unit_id UUID REFERENCES smartops.org_units(id) ON DELETE SET NULL,
  code VARCHAR(128) NOT NULL,
  name VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_teams_tenant_id ON smartops.teams(tenant_id);

CREATE TRIGGER set_teams_updated_at
BEFORE UPDATE ON smartops.teams
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES smartops.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES smartops.users(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'maintainer', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON smartops.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON smartops.team_members(user_id);

CREATE TABLE IF NOT EXISTS smartops.vcluster_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  team_id UUID REFERENCES smartops.teams(id) ON DELETE SET NULL,
  host_cluster VARCHAR(128) NOT NULL,
  vcluster_name VARCHAR(128) NOT NULL,
  namespace_pattern VARCHAR(256) NOT NULL DEFAULT '*',
  status VARCHAR(32) NOT NULL CHECK (status IN ('provisioning', 'ready', 'error', 'deleting')),
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (host_cluster, vcluster_name)
);

CREATE INDEX IF NOT EXISTS idx_vcluster_bindings_tenant_id
  ON smartops.vcluster_bindings(tenant_id);

CREATE TRIGGER set_vcluster_bindings_updated_at
BEFORE UPDATE ON smartops.vcluster_bindings
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.license_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  license_key VARCHAR(128) NOT NULL,
  tier VARCHAR(32) NOT NULL CHECK (tier IN ('standard', 'enterprise')),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_vclusters INTEGER NOT NULL DEFAULT 1,
  max_cpu_cores INTEGER NOT NULL DEFAULT 0,
  max_gpu_cores INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL CHECK (status IN ('active', 'expired', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_entitlements_tenant_id
  ON smartops.license_entitlements(tenant_id);

CREATE TRIGGER set_license_entitlements_updated_at
BEFORE UPDATE ON smartops.license_entitlements
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.resource_quota_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  resource_type VARCHAR(32) NOT NULL CHECK (
    resource_type IN ('vcluster', 'cpu_core', 'gpu_core', 'memory_gb', 'storage_gb')
  ),
  used NUMERIC(14,2) NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_quota_usage_tenant_resource
  ON smartops.resource_quota_usage(tenant_id, resource_type, captured_at DESC);

CREATE TABLE IF NOT EXISTS smartops.agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES smartops.users(id) ON DELETE SET NULL,
  trace_id VARCHAR(128),
  source VARCHAR(64) NOT NULL DEFAULT 'api',
  input_prompt TEXT NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (
    status IN (
      'planned',
      'running',
      'approval_required',
      'approved',
      'rejected',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),
  selected_agent_id VARCHAR(128),
  selected_action_id VARCHAR(128),
  risk_level VARCHAR(16) CHECK (risk_level IN ('low', 'medium', 'high')),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_tenant_status
  ON smartops.agent_tasks(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_trace_id ON smartops.agent_tasks(trace_id);

CREATE TRIGGER set_agent_tasks_updated_at
BEFORE UPDATE ON smartops.agent_tasks
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.approval_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES smartops.agent_tasks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  agent_id VARCHAR(128) NOT NULL,
  action_id VARCHAR(128) NOT NULL,
  risk_level VARCHAR(16) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  reason TEXT NOT NULL,
  requested_by UUID REFERENCES smartops.users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decision_note TEXT,
  decided_by UUID REFERENCES smartops.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_tickets_tenant_status
  ON smartops.approval_tickets(tenant_id, status, created_at DESC);

CREATE TRIGGER set_approval_tickets_updated_at
BEFORE UPDATE ON smartops.approval_tickets
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES smartops.agent_tasks(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES smartops.users(id) ON DELETE SET NULL,
  event_topic VARCHAR(128) NOT NULL,
  event_source VARCHAR(128) NOT NULL,
  trace_id VARCHAR(128),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_occurred_at
  ON smartops.audit_logs(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace_id ON smartops.audit_logs(trace_id);

COMMIT;
