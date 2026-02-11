BEGIN;

CREATE TABLE IF NOT EXISTS smartops.storage_tier_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE CASCADE,
  tier VARCHAR(16) NOT NULL CHECK (tier IN ('hot', 'warm', 'cold', 'block')),
  backend VARCHAR(64) NOT NULL,
  storage_class VARCHAR(128),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, tier)
);

CREATE TRIGGER set_storage_tier_policies_updated_at
BEFORE UPDATE ON smartops.storage_tier_policies
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.storage_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE CASCADE,
  scope VARCHAR(32) NOT NULL CHECK (scope IN ('vcluster', 'namespace', 'team')),
  scope_ref VARCHAR(128) NOT NULL,
  warm_storage_gib INTEGER NOT NULL DEFAULT 0,
  cold_archive_gib INTEGER NOT NULL DEFAULT 0,
  snapshot_limit INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, scope, scope_ref)
);

CREATE INDEX IF NOT EXISTS idx_storage_quotas_tenant
  ON smartops.storage_quotas(tenant_id);

CREATE TRIGGER set_storage_quotas_updated_at
BEFORE UPDATE ON smartops.storage_quotas
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.backup_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE CASCADE,
  policy_name VARCHAR(128) NOT NULL,
  config_backup_schedule VARCHAR(64) NOT NULL,
  data_backup_schedule VARCHAR(64) NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30,
  object_store_bucket VARCHAR(256),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, policy_name)
);

CREATE TRIGGER set_backup_policies_updated_at
BEFORE UPDATE ON smartops.backup_policies
FOR EACH ROW
EXECUTE FUNCTION smartops.set_updated_at();

CREATE TABLE IF NOT EXISTS smartops.backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES smartops.backup_policies(id) ON DELETE SET NULL,
  run_type VARCHAR(32) NOT NULL CHECK (
    run_type IN ('config', 'data', 'snapshot', 'restore_dry_run')
  ),
  status VARCHAR(32) NOT NULL CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed')
  ),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_tenant_status
  ON smartops.backup_runs(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS smartops.restore_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES smartops.tenants(id) ON DELETE CASCADE,
  run_id UUID REFERENCES smartops.backup_runs(id) ON DELETE SET NULL,
  target_namespace VARCHAR(128) NOT NULL,
  scenario VARCHAR(256) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (
    status IN ('planned', 'running', 'passed', 'failed')
  ),
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restore_drills_tenant_status
  ON smartops.restore_drills(tenant_id, status, created_at DESC);

COMMIT;
