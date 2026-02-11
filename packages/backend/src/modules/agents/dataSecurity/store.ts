import { DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';

export type TenantStorageQuota = {
  scope: 'vcluster' | 'namespace' | 'team';
  scopeRef: string;
  warmStorageGiB: number;
  coldArchiveGiB: number;
  snapshotLimit: number;
};

export type TenantStorageUsage = {
  storageGb: number;
  snapshots: number;
};

export type StorageTierPolicy = {
  tier: 'hot' | 'warm' | 'cold' | 'block';
  backend: string;
  storageClass?: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
};

export type BackupRunSnapshot = {
  id: string;
  tenantId: string;
  taskId?: string;
  traceId?: string;
  runType: 'config' | 'data' | 'snapshot' | 'restore_dry_run';
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt?: string;
  completedAt?: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export interface DataSecurityStore {
  getStorageTierPolicies(tenantId: string): Promise<StorageTierPolicy[]>;
  getTenantQuota(tenantId: string): Promise<TenantStorageQuota[]>;
  getTenantUsage(tenantId: string): Promise<TenantStorageUsage>;
  createBackupRun(options: {
    tenantId?: string;
    taskId?: string;
    traceId?: string;
    runType: 'config' | 'data' | 'snapshot' | 'restore_dry_run';
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    details?: Record<string, unknown>;
  }): Promise<string | null>;
  updateBackupRunStatus(options: {
    runId: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    details?: Record<string, unknown>;
  }): Promise<void>;
  linkBackupRunToTask(options: {
    runId: string;
    taskId: string;
    traceId?: string;
  }): Promise<void>;
  listBackupRuns(options: {
    tenantId?: string;
    runType?: 'config' | 'data' | 'snapshot' | 'restore_dry_run';
    status?: 'pending' | 'running' | 'succeeded' | 'failed';
    limit?: number;
  }): Promise<BackupRunSnapshot[]>;
  getBackupRun(runId: string): Promise<BackupRunSnapshot | null>;
  appendAuditEvent(options: {
    tenantId?: string;
    traceId?: string;
    eventTopic: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}

class NoopDataSecurityStore implements DataSecurityStore {
  async getStorageTierPolicies(): Promise<StorageTierPolicy[]> {
    return [];
  }

  async getTenantQuota(): Promise<TenantStorageQuota[]> {
    return [];
  }

  async getTenantUsage(): Promise<TenantStorageUsage> {
    return {
      storageGb: 0,
      snapshots: 0,
    };
  }

  async createBackupRun(): Promise<string | null> {
    return null;
  }

  async updateBackupRunStatus(): Promise<void> {}

  async linkBackupRunToTask(): Promise<void> {}

  async listBackupRuns(): Promise<BackupRunSnapshot[]> {
    return [];
  }

  async getBackupRun(): Promise<BackupRunSnapshot | null> {
    return null;
  }

  async appendAuditEvent(): Promise<void> {}
}

class PostgresDataSecurityStore implements DataSecurityStore {
  constructor(private readonly db: Knex, private readonly logger: LoggerService) {}

  async getStorageTierPolicies(tenantId: string): Promise<StorageTierPolicy[]> {
    try {
      const rows = await this.db('smartops.storage_tier_policies')
        .select(['tier', 'backend', 'storage_class', 'parameters', 'enabled'])
        .where({ tenant_id: tenantId, enabled: true });

      return rows.map(row => ({
        tier: row.tier,
        backend: String(row.backend),
        storageClass: row.storage_class ? String(row.storage_class) : undefined,
        parameters:
          typeof row.parameters === 'string'
            ? (JSON.parse(row.parameters) as Record<string, unknown>)
            : ((row.parameters as Record<string, unknown> | null) ?? {}),
        enabled: Boolean(row.enabled),
      }));
    } catch (error) {
      this.logger.warn(`Storage tier policy query failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getTenantQuota(tenantId: string): Promise<TenantStorageQuota[]> {
    try {
      const rows = await this.db('smartops.storage_quotas')
        .select([
          'scope',
          'scope_ref',
          'warm_storage_gib',
          'cold_archive_gib',
          'snapshot_limit',
        ])
        .where({ tenant_id: tenantId });

      return rows.map(row => ({
        scope: row.scope,
        scopeRef: String(row.scope_ref),
        warmStorageGiB: Number(row.warm_storage_gib ?? 0),
        coldArchiveGiB: Number(row.cold_archive_gib ?? 0),
        snapshotLimit: Number(row.snapshot_limit ?? 0),
      }));
    } catch (error) {
      this.logger.warn(`Storage quota query failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getTenantUsage(tenantId: string): Promise<TenantStorageUsage> {
    try {
      const storageRow = await this.db('smartops.resource_quota_usage')
        .select(['used'])
        .where({ tenant_id: tenantId, resource_type: 'storage_gb' })
        .orderBy('captured_at', 'desc')
        .first();

      const snapshotRow = await this.db('smartops.backup_runs')
        .count({ count: '*' })
        .where({ tenant_id: tenantId, run_type: 'snapshot' })
        .first();

      return {
        storageGb: Number(storageRow?.used ?? 0),
        snapshots: Number(snapshotRow?.count ?? 0),
      };
    } catch (error) {
      this.logger.warn(`Storage usage query failed: ${(error as Error).message}`);
      return {
        storageGb: 0,
        snapshots: 0,
      };
    }
  }

  async createBackupRun(options: {
    tenantId?: string;
    taskId?: string;
    traceId?: string;
    runType: 'config' | 'data' | 'snapshot' | 'restore_dry_run';
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    details?: Record<string, unknown>;
  }): Promise<string | null> {
    if (!options.tenantId) {
      return null;
    }

    try {
      const [row] = await this.db('smartops.backup_runs')
        .insert({
          tenant_id: options.tenantId,
          task_id: options.taskId ?? null,
          trace_id: options.traceId ?? null,
          run_type: options.runType,
          status: options.status,
          started_at: this.db.fn.now(),
          details: JSON.stringify(options.details ?? {}),
        })
        .returning(['id']);

      return row?.id ? String(row.id) : null;
    } catch (error) {
      this.logger.warn(`Backup run insert failed: ${(error as Error).message}`);
      return null;
    }
  }

  async updateBackupRunStatus(options: {
    runId: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    details?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db('smartops.backup_runs')
        .where({ id: options.runId })
        .update({
          status: options.status,
          details:
            options.details === undefined
              ? this.db.raw('details')
              : JSON.stringify(options.details),
          completed_at:
            options.status === 'succeeded' || options.status === 'failed'
              ? this.db.fn.now()
              : null,
        });
    } catch (error) {
      this.logger.warn(`Backup run update failed: ${(error as Error).message}`);
    }
  }

  async linkBackupRunToTask(options: {
    runId: string;
    taskId: string;
    traceId?: string;
  }): Promise<void> {
    try {
      await this.db('smartops.backup_runs').where({ id: options.runId }).update({
        task_id: options.taskId,
        trace_id: options.traceId ?? null,
      });
    } catch (error) {
      this.logger.warn(`Backup run task link update failed: ${(error as Error).message}`);
    }
  }

  async listBackupRuns(options: {
    tenantId?: string;
    runType?: 'config' | 'data' | 'snapshot' | 'restore_dry_run';
    status?: 'pending' | 'running' | 'succeeded' | 'failed';
    limit?: number;
  }): Promise<BackupRunSnapshot[]> {
    try {
      const limit = Math.max(1, Math.min(100, options.limit ?? 20));
      const query = this.db('smartops.backup_runs')
        .select([
          'id',
          'tenant_id',
          'task_id',
          'trace_id',
          'run_type',
          'status',
          'started_at',
          'completed_at',
          'details',
          'created_at',
        ])
        .orderBy('created_at', 'desc')
        .limit(limit);

      if (options.tenantId) {
        query.where('tenant_id', options.tenantId);
      }
      if (options.runType) {
        query.where('run_type', options.runType);
      }
      if (options.status) {
        query.where('status', options.status);
      }

      const rows = await query;
      return rows.map(row => {
        const rawDetails = row.details;
        const details =
          typeof rawDetails === 'string'
            ? (JSON.parse(rawDetails) as Record<string, unknown>)
            : ((rawDetails as Record<string, unknown> | null) ?? {});

        return {
          id: String(row.id),
          tenantId: String(row.tenant_id),
          taskId: row.task_id ? String(row.task_id) : undefined,
          traceId: row.trace_id ? String(row.trace_id) : undefined,
          runType: row.run_type,
          status: row.status,
          startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
          completedAt: row.completed_at
            ? new Date(row.completed_at).toISOString()
            : undefined,
          details,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });
    } catch (error) {
      this.logger.warn(`Backup run list query failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getBackupRun(runId: string): Promise<BackupRunSnapshot | null> {
    try {
      const row = await this.db('smartops.backup_runs')
        .select([
          'id',
          'tenant_id',
          'task_id',
          'trace_id',
          'run_type',
          'status',
          'started_at',
          'completed_at',
          'details',
          'created_at',
        ])
        .where({ id: runId })
        .first();

      if (!row) {
        return null;
      }

      const rawDetails = row.details;
      const details =
        typeof rawDetails === 'string'
          ? (JSON.parse(rawDetails) as Record<string, unknown>)
          : ((rawDetails as Record<string, unknown> | null) ?? {});

      return {
        id: String(row.id),
        tenantId: String(row.tenant_id),
        taskId: row.task_id ? String(row.task_id) : undefined,
        traceId: row.trace_id ? String(row.trace_id) : undefined,
        runType: row.run_type,
        status: row.status,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
        completedAt: row.completed_at
          ? new Date(row.completed_at).toISOString()
          : undefined,
        details,
        createdAt: new Date(row.created_at).toISOString(),
      };
    } catch (error) {
      this.logger.warn(`Backup run query failed: ${(error as Error).message}`);
      return null;
    }
  }

  async appendAuditEvent(options: {
    tenantId?: string;
    traceId?: string;
    eventTopic: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    if (!options.tenantId) {
      return;
    }

    try {
      await this.db('smartops.audit_logs').insert({
        tenant_id: options.tenantId,
        trace_id: options.traceId ?? null,
        event_topic: options.eventTopic,
        event_source: 'agent-data-security',
        payload: JSON.stringify(options.payload ?? {}),
      });
    } catch (error) {
      this.logger.warn(
        `Data security audit event insert failed: ${(error as Error).message}`,
      );
    }
  }
}

export const createDataSecurityStore = async (
  database: DatabaseService,
  logger: LoggerService,
): Promise<DataSecurityStore> => {
  try {
    const client = (await database.getClient()) as unknown as Knex;
    return new PostgresDataSecurityStore(client, logger);
  } catch (error) {
    logger.warn(
      `DataSecurityStore DB unavailable, using noop: ${(error as Error).message}`,
    );
    return new NoopDataSecurityStore();
  }
};
