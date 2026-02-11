import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { agentRegistry } from '../../agentPlatform';
import { joinUrl, requestJson } from '../shared/http';

type TrivyScanResponse = {
  ArtifactName?: string;
  Results?: Array<{
    Target?: string;
    Vulnerabilities?: Array<{
      Severity?: string;
    }>;
  }>;
};

export const securityControlAgentBackend = createBackendPlugin({
  pluginId: 'agent-security-control',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ logger, config }) {
        const vaultBaseUrl = config.getOptionalString('smartops.integrations.vault.baseUrl');
        const vaultToken = config.getOptionalString('smartops.integrations.vault.token');

        const kyvernoBaseUrl = config.getOptionalString(
          'smartops.integrations.kyverno.baseUrl',
        );

        const trivyBaseUrl = config.getOptionalString('smartops.integrations.trivy.baseUrl');

        agentRegistry.register(
          {
            id: 'security-control',
            name: 'Security Control Agent',
            description:
              'Vault secret operations, Kyverno policy checks, and Trivy image scanning',
            version: '0.1.0',
            actions: [
              {
                id: 'rotate-secret',
                title: 'Rotate Secret',
                description: 'Writes rotated secret value into Vault path',
                riskLevel: 'high',
                inputExample: {
                  path: 'kv/data/team-a/app',
                  data: {
                    password: '***',
                  },
                },
              },
              {
                id: 'policy-report',
                title: 'Get Kyverno Policy Report',
                description: 'Fetches policy report from Kyverno endpoint',
                riskLevel: 'low',
                inputExample: {
                  namespace: 'team-a',
                },
              },
              {
                id: 'image-scan',
                title: 'Scan Image via Trivy',
                description: 'Triggers image scan on Trivy service endpoint',
                riskLevel: 'medium',
                inputExample: {
                  image: 'registry.example.com/team-a/app:1.0.0',
                },
              },
            ],
            uiExtensions: [
              {
                id: 'security-settings-panel',
                title: 'Security Control Agent',
                placement: 'settings',
                description: 'Security actions for secret, policy, and image checks',
              },
            ],
          },
          {
            'rotate-secret': async request => {
              if (!vaultBaseUrl || !vaultToken) {
                return {
                  status: 'error',
                  error: 'Missing Vault integration config: baseUrl/token',
                };
              }

              const path = String(request.input?.path ?? '');
              const data = (request.input?.data ?? {}) as Record<string, unknown>;
              if (!path) {
                return {
                  status: 'error',
                  error: 'Missing Vault secret path',
                };
              }

              const result = await requestJson<Record<string, unknown>>(
                joinUrl(vaultBaseUrl, `/v1/${path}`),
                {
                  method: 'POST',
                  headers: {
                    'X-Vault-Token': vaultToken,
                  },
                  body: JSON.stringify({
                    data,
                  }),
                },
              );

              return {
                status: 'ok',
                output: {
                  rotated: true,
                  path,
                  result,
                },
              };
            },
            'policy-report': async request => {
              if (!kyvernoBaseUrl) {
                return {
                  status: 'error',
                  error: 'Missing Kyverno integration config: baseUrl',
                };
              }

              const namespace = String(request.input?.namespace ?? 'default');
              const report = await requestJson<Record<string, unknown>>(
                joinUrl(
                  kyvernoBaseUrl,
                  `/apis/wgpolicyk8s.io/v1alpha2/namespaces/${encodeURIComponent(namespace)}/policyreports`,
                ),
              );

              return {
                status: 'ok',
                output: report,
              };
            },
            'image-scan': async request => {
              if (!trivyBaseUrl) {
                return {
                  status: 'error',
                  error: 'Missing Trivy integration config: baseUrl',
                };
              }

              const image = String(request.input?.image ?? '');
              if (!image) {
                return {
                  status: 'error',
                  error: 'Missing image',
                };
              }

              const scanResult = await requestJson<TrivyScanResponse>(
                joinUrl(trivyBaseUrl, '/scan'),
                {
                  method: 'POST',
                  body: JSON.stringify({
                    image,
                  }),
                },
              );

              const vulnerabilities =
                scanResult.Results?.flatMap(item => item.Vulnerabilities ?? []) ?? [];
              const severityCount = vulnerabilities.reduce<Record<string, number>>(
                (acc, vulnerability) => {
                  const key = vulnerability.Severity ?? 'UNKNOWN';
                  acc[key] = (acc[key] ?? 0) + 1;
                  return acc;
                },
                {},
              );

              return {
                status: 'ok',
                output: {
                  image,
                  artifact: scanResult.ArtifactName,
                  vulnerabilityCount: vulnerabilities.length,
                  severityCount,
                  raw: scanResult,
                },
              };
            },
          },
        );

        logger.info('Registered security control agent');
      },
    });
  },
});
