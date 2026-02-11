# SmartOps Agent Platform Migrations

Initial schema migration:

- `0001_smartops_foundation.sql`
- `0002_smart_storage.sql`
- `0003_backup_runs_task_link.sql`

Apply manually in development:

```bash
psql "$DATABASE_URL" -f packages/backend/src/modules/agentPlatform/migrations/0001_smartops_foundation.sql
```

The migration creates the `smartops` schema and foundational tables for:

- IAM org and team mapping
- tenant and vCluster bindings
- license entitlements and quota usage
- AI task execution, approvals, and audit logs

`0002_smart_storage.sql` extends this with Smart Storage governance tables:

- storage tier policies (hot/warm/cold/block)
- tenant storage quotas
- backup policy and run history
- restore drill history

`0003_backup_runs_task_link.sql` adds linkage fields from storage backup runs to
agent tasks and trace IDs for cross-navigation in UI and observability.
