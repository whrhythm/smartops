import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { agentRegistry } from '../../agentPlatform';
import { joinUrl, requestJson } from '../shared/http';

type GitLabPipeline = {
  id: number;
  status: string;
  ref: string;
  web_url: string;
  updated_at: string;
};

type ArgoApp = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  status?: {
    health?: {
      status?: string;
    };
    sync?: {
      status?: string;
    };
  };
};

export const cicdAgentBackend = createBackendPlugin({
  pluginId: 'agent-cicd',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ logger, config }) {
        const gitlabBaseUrl = config.getOptionalString('smartops.integrations.gitlab.baseUrl');
        const gitlabToken = config.getOptionalString('smartops.integrations.gitlab.token');
        const gitlabProjectId = config.getOptionalString(
          'smartops.integrations.gitlab.iacProjectId',
        );

        const argocdBaseUrl = config.getOptionalString('smartops.integrations.argocd.baseUrl');
        const argocdToken = config.getOptionalString('smartops.integrations.argocd.token');

        agentRegistry.register(
          {
            id: 'cicd',
            name: 'CI/CD Agent',
            description: 'Integrates GitLab CI and Argo CD deployment operations',
            version: '0.1.0',
            actions: [
              {
                id: 'list-pipelines',
                title: 'List GitLab Pipelines',
                description: 'List latest pipelines in GitLab project',
                riskLevel: 'low',
                inputExample: {
                  projectId: '123',
                  perPage: 5,
                },
              },
              {
                id: 'run-pipeline',
                title: 'Run GitLab Pipeline',
                description: 'Trigger pipeline with branch and variables',
                riskLevel: 'medium',
                inputExample: {
                  projectId: '123',
                  ref: 'main',
                  variables: {
                    DEPLOY_ENV: 'staging',
                  },
                },
              },
              {
                id: 'sync-application',
                title: 'Sync Argo CD Application',
                description: 'Trigger Argo CD app sync',
                riskLevel: 'high',
                inputExample: {
                  appName: 'team-a-service',
                },
              },
              {
                id: 'get-application-health',
                title: 'Get Argo CD Application Health',
                description: 'Query app sync and health status',
                riskLevel: 'low',
                inputExample: {
                  appName: 'team-a-service',
                },
              },
            ],
            uiExtensions: [
              {
                id: 'cicd-settings-panel',
                title: 'CI/CD Agent',
                placement: 'settings',
                description: 'GitLab and Argo CD dynamic operations panel',
              },
            ],
          },
          {
            'list-pipelines': async request => {
              if (!gitlabBaseUrl || !gitlabToken || !gitlabProjectId) {
                return {
                  status: 'error',
                  error:
                    'Missing GitLab integration config: baseUrl/token/iacProjectId',
                };
              }

              const projectId =
                String(request.input?.projectId ?? gitlabProjectId);
              const perPage = Number(request.input?.perPage ?? 10);

              const pipelines = await requestJson<GitLabPipeline[]>(
                joinUrl(
                  gitlabBaseUrl,
                  `/api/v4/projects/${encodeURIComponent(projectId)}/pipelines?per_page=${Math.max(
                    1,
                    Math.min(50, perPage),
                  )}`,
                ),
                {
                  headers: {
                    'PRIVATE-TOKEN': gitlabToken,
                  },
                },
              );

              return {
                status: 'ok',
                output: {
                  total: pipelines.length,
                  pipelines,
                },
              };
            },
            'run-pipeline': async request => {
              if (!gitlabBaseUrl || !gitlabToken || !gitlabProjectId) {
                return {
                  status: 'error',
                  error:
                    'Missing GitLab integration config: baseUrl/token/iacProjectId',
                };
              }

              const projectId =
                String(request.input?.projectId ?? gitlabProjectId);
              const ref = String(request.input?.ref ?? 'main');
              const variables = (request.input?.variables ?? {}) as Record<
                string,
                string
              >;

              const form = new URLSearchParams();
              form.append('ref', ref);
              Object.entries(variables).forEach(([key, value]) => {
                form.append(`variables[${key}]`, value);
              });

              const response = await fetch(
                joinUrl(
                  gitlabBaseUrl,
                  `/api/v4/projects/${encodeURIComponent(projectId)}/pipeline`,
                ),
                {
                  method: 'POST',
                  headers: {
                    'PRIVATE-TOKEN': gitlabToken,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: form,
                },
              );

              if (!response.ok) {
                return {
                  status: 'error',
                  error: `GitLab pipeline trigger failed: ${response.status} ${await response.text()}`,
                };
              }

              return {
                status: 'ok',
                output: await response.json(),
              };
            },
            'sync-application': async request => {
              if (!argocdBaseUrl || !argocdToken) {
                return {
                  status: 'error',
                  error: 'Missing Argo CD integration config: baseUrl/token',
                };
              }

              const appName = String(request.input?.appName ?? '');
              if (!appName) {
                return {
                  status: 'error',
                  error: 'Missing appName',
                };
              }

              const response = await fetch(
                joinUrl(argocdBaseUrl, `/api/v1/applications/${encodeURIComponent(appName)}/sync`),
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${argocdToken}`,
                  },
                },
              );

              if (!response.ok) {
                return {
                  status: 'error',
                  error: `Argo CD sync failed: ${response.status} ${await response.text()}`,
                };
              }

              return {
                status: 'ok',
                output: await response.json(),
              };
            },
            'get-application-health': async request => {
              if (!argocdBaseUrl || !argocdToken) {
                return {
                  status: 'error',
                  error: 'Missing Argo CD integration config: baseUrl/token',
                };
              }

              const appName = String(request.input?.appName ?? '');
              if (!appName) {
                return {
                  status: 'error',
                  error: 'Missing appName',
                };
              }

              const app = await requestJson<ArgoApp>(
                joinUrl(argocdBaseUrl, `/api/v1/applications/${encodeURIComponent(appName)}`),
                {
                  headers: {
                    Authorization: `Bearer ${argocdToken}`,
                  },
                },
              );

              return {
                status: 'ok',
                output: {
                  appName: app.metadata?.name,
                  namespace: app.metadata?.namespace,
                  health: app.status?.health?.status,
                  sync: app.status?.sync?.status,
                },
              };
            },
          },
        );

        logger.info('Registered CI/CD agent');
      },
    });
  },
});
