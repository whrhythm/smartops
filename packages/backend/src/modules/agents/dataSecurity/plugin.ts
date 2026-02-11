import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { agentRegistry } from '../../agentPlatform';
import { joinUrl, requestJson } from '../shared/http';
import { createDataSecurityStore } from './store';

type VeleroScheduleList = {
  items?: Array<{
    metadata?: { name?: string; namespace?: string };
    spec?: { schedule?: string };
    status?: { phase?: string; lastBackup?: string };
  }>;
};

type VeleroBackup = {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
  status?: { phase?: string; completionTimestamp?: string; errors?: number };
};

const probeEndpoint = async (baseUrl?: string) => {
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(baseUrl, { method: 'GET' });
    return {
      configured: true,
      reachable: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - startedAt,
    };
  }
};

export const dataSecurityAgentBackend = createBackendPlugin({
  pluginId: 'agent-data-security',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
      },
      async init({ logger, config, database }) {
        const dataStore = await createDataSecurityStore(database, logger);
        const veleroBaseUrl = config.getOptionalString(
          'smartops.integrations.velero.baseUrl',
        );
        const openebsBaseUrl = config.getOptionalString(
          'smartops.integrations.openebs.baseUrl',
        );
        const juicefsBaseUrl = config.getOptionalString(
          'smartops.integrations.juicefs.baseUrl',
        );

        agentRegistry.register(
          {
            id: 'data-security',
            name: 'Data Storage & Security Agent',
            description:
              'Storage tier status, quota visibility, backup checks, and restore dry-runs',
            version: '0.1.0',
            actions: [
              {
                id: 'storage-tier-status',
                title: 'Storage Tier Status',
                description: 'Returns hot/warm/cold storage layer health and topology',
                riskLevel: 'low',
                inputExample: {
                  clusterId: 'cluster-a',
                  tenantId: 'tenant-a',
                },
              },
              {
                id: 'tenant-storage-quota',
                title: 'Tenant Storage Quota',
                description: 'Shows tenant storage quota and current usage',
                riskLevel: 'low',
                inputExample: {
                  tenantId: 'tenant-a',
                },
              },
              {
                id: 'backup-plan-check',
                title: 'Backup Plan Check',
                description: 'Lists configured Velero schedules and recent status',
                riskLevel: 'low',
                inputExample: {
                  namespace: 'velero',
                  tenantId: 'tenant-a',
                },
              },
              {
                id: 'snapshot-create',
                title: 'Create Snapshot',
                description: 'Triggers storage snapshot workflow for a protected workload',
                riskLevel: 'medium',
                inputExample: {
                  namespace: 'team-a',
                  pvc: 'postgres-data',
                  tenantId: 'tenant-a',
                },
              },
              {
                id: 'restore-dry-run',
                title: 'Restore Dry Run',
                description: 'Validates restore procedure without applying changes',
                riskLevel: 'high',
                inputExample: {
                  backupName: 'daily-tenant-a-2026-02-08',
                  namespace: 'velero',
                  targetNamespace: 'restore-validation',
                  tenantId: 'tenant-a',
                },
              },
              {
                id: 'backup-run-list',
                title: 'Backup Run List',
                description: 'Lists backup and restore dry-run history records',
                riskLevel: 'low',
                inputExample: {
                  tenantId: 'tenant-a',
                  runType: 'snapshot',
                  status: 'succeeded',
                  limit: 20,
                },
              },
              {
                id: 'backup-run-get',
                title: 'Backup Run Detail',
                description: 'Returns details for one backup run by ID',
                riskLevel: 'low',
                inputExample: {
                  runId: 'c74f5a58-d7a2-4f6a-beb8-9af6f7f0d300',
                },
              },
            ],
            uiExtensions: [
              {
                id: 'data-security-settings-panel',
                title: 'Data Security Agent',
                placement: 'settings',
                description: 'Storage, backup, and restore governance operations',
              },
            ],
          },
          {
            'storage-tier-status': async request => {
              const clusterId = String(request.input?.clusterId ?? 'default-cluster');
              const tenantId = String(
                request.input?.tenantId ?? request.context?.tenantId ?? '',
              );

              const [openebsProbe, juicefsProbe] = await Promise.all([
                probeEndpoint(openebsBaseUrl),
                probeEndpoint(juicefsBaseUrl),
              ]);

              const tierPolicies = tenantId
                ? await dataStore.getStorageTierPolicies(tenantId)
                : [];

              return {
                status: 'ok',
                output: {
                  clusterId,
                  tenantId: tenantId || undefined,
                  tierPolicies,
                  tiers: {
                    hot: {
                      technology: 'Node Local NVMe',
                      purpose: 'KV cache and low-latency temporary data',
                      status: 'healthy',
                    },
                    warm: {
                      technology: 'JuiceFS',
                      purpose: 'Cross-cluster model weights and shared datasets',
                      status: juicefsProbe.configured
                        ? juicefsProbe.reachable
                          ? 'connected'
                          : 'degraded'
                        : 'not_configured',
                      endpoint: juicefsBaseUrl,
                      probe: juicefsProbe,
                    },
                    cold: {
                      technology: 'S3 compatible object storage',
                      purpose: 'Long-term archive and disaster backup',
                      status: 'managed',
                    },
                    block: {
                      technology: 'OpenEBS',
                      purpose: 'Database and transactional persistent volumes',
                      status: openebsProbe.configured
                        ? openebsProbe.reachable
                          ? 'connected'
                          : 'degraded'
                        : 'not_configured',
                      endpoint: openebsBaseUrl,
                      probe: openebsProbe,
                    },
                  },
                },
              };
            },
            'tenant-storage-quota': async request => {
              const tenantId = String(
                request.input?.tenantId ?? request.context?.tenantId ?? 'unknown',
              );

              const quota =
                tenantId !== 'unknown'
                  ? await dataStore.getTenantQuota(tenantId)
                  : [];
              const usage =
                tenantId !== 'unknown'
                  ? await dataStore.getTenantUsage(tenantId)
                  : {
                      storageGb: 0,
                      snapshots: 0,
                    };

              return {
                status: 'ok',
                output: {
                  tenantId,
                  quota:
                    quota.length > 0
                      ? quota
                      : [
                          {
                            scope: 'vcluster',
                            scopeRef: 'default',
                            warmStorageGiB: 2048,
                            coldArchiveGiB: 10240,
                            snapshotLimit: 60,
                          },
                        ],
                  usage,
                },
              };
            },
            'backup-plan-check': async request => {
              const namespace = String(request.input?.namespace ?? 'velero');
              const tenantId = String(
                request.input?.tenantId ?? request.context?.tenantId ?? '',
              );

              if (!veleroBaseUrl) {
                const backupRunId = await dataStore.createBackupRun({
                  tenantId: tenantId || undefined,
                  runType: 'config',
                  status: 'succeeded',
                  details: {
                    namespace,
                    fallback: true,
                  },
                });

                return {
                  status: 'ok',
                  output: {
                    namespace,
                    warning:
                      'Velero integration not configured. Returning policy baseline only.',
                    policy: {
                      configBackup: 'daily',
                      dataBackup: 'every 6h',
                      retention: '30d',
                    },
                    backupRunId,
                  },
                };
              }

              const [schedules, backups] = await Promise.all([
                requestJson<VeleroScheduleList>(
                  joinUrl(
                    veleroBaseUrl,
                    `/apis/velero.io/v1/namespaces/${encodeURIComponent(namespace)}/schedules`,
                  ),
                ),
                requestJson<{ items?: VeleroBackup[] }>(
                  joinUrl(
                    veleroBaseUrl,
                    `/apis/velero.io/v1/namespaces/${encodeURIComponent(namespace)}/backups`,
                  ),
                ),
              ]);

              const recentBackups = (backups.items ?? [])
                .sort((a, b) => {
                  const aTs = a.metadata?.creationTimestamp
                    ? Date.parse(a.metadata.creationTimestamp)
                    : 0;
                  const bTs = b.metadata?.creationTimestamp
                    ? Date.parse(b.metadata.creationTimestamp)
                    : 0;
                  return bTs - aTs;
                })
                .slice(0, 10);

              const backupRunId = await dataStore.createBackupRun({
                tenantId: tenantId || undefined,
                runType: 'config',
                status: 'succeeded',
                details: {
                  namespace,
                  schedules: (schedules.items ?? []).length,
                  recentBackups: recentBackups.length,
                },
              });

              await dataStore.appendAuditEvent({
                tenantId: tenantId || undefined,
                eventTopic: 'storage.backup.plan.checked',
                payload: {
                  namespace,
                  scheduleCount: (schedules.items ?? []).length,
                  recentBackupCount: recentBackups.length,
                  backupRunId,
                },
              });

              return {
                status: 'ok',
                output: {
                  namespace,
                  schedules: schedules.items ?? [],
                  recentBackups,
                  backupRunId,
                },
              };
            },
            'snapshot-create': async request => {
              const namespace = String(request.input?.namespace ?? 'default');
              const pvc = String(request.input?.pvc ?? 'unknown-pvc');
              const tenantId = String(
                request.input?.tenantId ?? request.context?.tenantId ?? '',
              );

              if (!veleroBaseUrl) {
                await dataStore.appendAuditEvent({
                  tenantId: tenantId || undefined,
                  eventTopic: 'storage.snapshot.requested',
                  payload: {
                    namespace,
                    pvc,
                    mode: 'dry',
                  },
                });

                return {
                  status: 'ok',
                  output: {
                    requested: true,
                    namespace,
                    pvc,
                    mode: 'controller_workflow',
                    message:
                      'Velero integration missing. Snapshot request recorded in dry mode.',
                  },
                };
              }

              const backupName = `snapshot-${namespace}-${pvc}-${Date.now()}`;
              const runId = await dataStore.createBackupRun({
                tenantId: tenantId || undefined,
                runType: 'snapshot',
                status: 'running',
                details: {
                  namespace,
                  pvc,
                  backupName,
                },
              });

              try {
                const veleroResponse = await requestJson<Record<string, unknown>>(
                  joinUrl(
                    veleroBaseUrl,
                    `/apis/velero.io/v1/namespaces/${encodeURIComponent(namespace)}/backups`,
                  ),
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      apiVersion: 'velero.io/v1',
                      kind: 'Backup',
                      metadata: {
                        name: backupName,
                      },
                      spec: {
                        includedNamespaces: [namespace],
                        includedResources: ['persistentvolumeclaims', 'persistentvolumes'],
                        snapshotVolumes: true,
                      },
                    }),
                  },
                );

                if (runId) {
                  await dataStore.updateBackupRunStatus({
                    runId,
                    status: 'succeeded',
                    details: {
                      namespace,
                      pvc,
                      backupName,
                    },
                  });
                }

                await dataStore.appendAuditEvent({
                  tenantId: tenantId || undefined,
                  eventTopic: 'storage.snapshot.succeeded',
                  payload: {
                    namespace,
                    pvc,
                    backupName,
                    backupRunId: runId,
                  },
                });

                return {
                  status: 'ok',
                  output: {
                    requested: true,
                    namespace,
                    pvc,
                    backupName,
                    backupRunId: runId,
                    velero: veleroResponse,
                  },
                };
              } catch (error) {
                if (runId) {
                  await dataStore.updateBackupRunStatus({
                    runId,
                    status: 'failed',
                    details: {
                      namespace,
                      pvc,
                      backupName,
                      error: (error as Error).message,
                    },
                  });
                }

                await dataStore.appendAuditEvent({
                  tenantId: tenantId || undefined,
                  eventTopic: 'storage.snapshot.failed',
                  payload: {
                    namespace,
                    pvc,
                    backupName,
                    backupRunId: runId,
                    error: (error as Error).message,
                  },
                });

                return {
                  status: 'error',
                  error: `Snapshot creation failed: ${(error as Error).message}`,
                };
              }
            },
            'restore-dry-run': async request => {
              const backupName = String(request.input?.backupName ?? 'unknown-backup');
              const targetNamespace = String(
                request.input?.targetNamespace ?? 'restore-validation',
              );
              const namespace = String(request.input?.namespace ?? 'velero');
              const tenantId = String(
                request.input?.tenantId ?? request.context?.tenantId ?? '',
              );

              const runId = await dataStore.createBackupRun({
                tenantId: tenantId || undefined,
                runType: 'restore_dry_run',
                status: 'running',
                details: {
                  backupName,
                  targetNamespace,
                },
              });

              const [veleroProbe, openebsProbe, juicefsProbe] = await Promise.all([
                probeEndpoint(veleroBaseUrl),
                probeEndpoint(openebsBaseUrl),
                probeEndpoint(juicefsBaseUrl),
              ]);

              let backupExists = false;
              if (veleroBaseUrl) {
                try {
                  await requestJson<Record<string, unknown>>(
                    joinUrl(
                      veleroBaseUrl,
                      `/apis/velero.io/v1/namespaces/${encodeURIComponent(namespace)}/backups/${encodeURIComponent(backupName)}`,
                    ),
                  );
                  backupExists = true;
                } catch {
                  backupExists = false;
                }
              }

              const checks = {
                backupExists,
                veleroReachable: veleroProbe.reachable,
                openebsReachable: openebsProbe.reachable,
                juicefsReachable: juicefsProbe.reachable,
                policyGate: backupExists ? 'pass' : 'fail',
              };

              if (runId) {
                await dataStore.updateBackupRunStatus({
                  runId,
                  status: backupExists ? 'succeeded' : 'failed',
                  details: {
                    backupName,
                    targetNamespace,
                    checks,
                  },
                });
              }

              if (!backupExists) {
                await dataStore.appendAuditEvent({
                  tenantId: tenantId || undefined,
                  eventTopic: 'storage.restore.dryrun.failed',
                  payload: {
                    backupName,
                    targetNamespace,
                    checks,
                    backupRunId: runId,
                  },
                });

                return {
                  status: 'error',
                  error:
                    'Restore dry-run failed: backup not found or Velero API not reachable',
                };
              }

              await dataStore.appendAuditEvent({
                tenantId: tenantId || undefined,
                eventTopic: 'storage.restore.dryrun.succeeded',
                payload: {
                  backupName,
                  targetNamespace,
                  checks,
                  backupRunId: runId,
                },
              });

              return {
                status: 'ok',
                output: {
                  backupName,
                  targetNamespace,
                  dryRun: true,
                  checks,
                  backupRunId: runId,
                  message:
                    'Dry run passed. Actual restore requires approval and execution window.',
                },
              };
            },
            'backup-run-list': async request => {
              const tenantId = String(
                request.input?.tenantId ?? request.context?.tenantId ?? '',
              );
              const runType = request.input?.runType
                ? String(request.input.runType)
                : undefined;
              const status = request.input?.status
                ? String(request.input.status)
                : undefined;
              const limit = request.input?.limit
                ? Number(request.input.limit)
                : undefined;

              const runs = await dataStore.listBackupRuns({
                tenantId: tenantId || undefined,
                runType:
                  runType === 'config' ||
                  runType === 'data' ||
                  runType === 'snapshot' ||
                  runType === 'restore_dry_run'
                    ? runType
                    : undefined,
                status:
                  status === 'pending' ||
                  status === 'running' ||
                  status === 'succeeded' ||
                  status === 'failed'
                    ? status
                    : undefined,
                limit,
              });

              return {
                status: 'ok',
                output: {
                  total: runs.length,
                  runs,
                },
              };
            },
            'backup-run-get': async request => {
              const runId = String(request.input?.runId ?? '');
              if (!runId) {
                return {
                  status: 'error',
                  error: 'Missing runId',
                };
              }

              const run = await dataStore.getBackupRun(runId);
              if (!run) {
                return {
                  status: 'error',
                  error: `Backup run ${runId} not found`,
                };
              }

              return {
                status: 'ok',
                output: run,
              };
            },
          },
        );

        logger.info('Registered data storage security agent');
      },
    });
  },
});
