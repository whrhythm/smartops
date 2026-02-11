import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { agentRegistry, createAgentTemplate } from '../../agentPlatform';

export const kubernetesAgentBackend = createBackendPlugin({
  pluginId: 'agent-kubernetes',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      async init({ logger }) {
        const template = createAgentTemplate(
          {
            id: 'kubernetes',
            name: 'Kubernetes Agent',
            description: 'Queries and controls Kubernetes resources',
            version: '0.1.0',
            actions: [
              {
                id: 'list-resources',
                title: 'List Resources',
                description: 'List namespaces or workloads by scope',
                riskLevel: 'low',
                inputExample: {
                  clusterId: 'cluster-a',
                  namespace: 'team-a',
                  kind: 'Deployment',
                },
              },
              {
                id: 'scale-workload',
                title: 'Scale Workload',
                description: 'Scale deployment or statefulset replicas',
                riskLevel: 'medium',
                inputExample: {
                  clusterId: 'cluster-a',
                  namespace: 'team-a',
                  kind: 'Deployment',
                  name: 'web',
                  replicas: 3,
                },
              },
            ],
            uiExtensions: [
              {
                id: 'kubernetes-settings-panel',
                title: 'Kubernetes Agent',
                placement: 'settings',
                description: 'Dynamic action console for Kubernetes operations',
              },
            ],
          },
          {
            'list-resources': async request => ({
              status: 'ok',
              output: {
                message: 'Kubernetes connector not wired yet',
                request,
              },
            }),
            'scale-workload': async request => ({
              status: 'ok',
              output: {
                message: 'Dry-run scaling request accepted',
                request,
              },
            }),
          },
        );

        agentRegistry.register(template.definition, template.handlers);

        logger.info('Registered built-in Kubernetes agent');
      },
    });
  },
});
