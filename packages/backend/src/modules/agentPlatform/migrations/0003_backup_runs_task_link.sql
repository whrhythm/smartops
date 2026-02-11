BEGIN;

ALTER TABLE smartops.backup_runs
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES smartops.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trace_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_backup_runs_task_id
  ON smartops.backup_runs(task_id);

CREATE INDEX IF NOT EXISTS idx_backup_runs_trace_id
  ON smartops.backup_runs(trace_id);

COMMIT;
