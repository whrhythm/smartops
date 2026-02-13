import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { createRouter } from './service/router';

export const aiOrchestratorBackend = createBackendPlugin({
  pluginId: 'ai-orchestrator',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        discovery: coreServices.discovery,
      },
      async init({ http, logger, config, discovery }) {
        http.addAuthPolicy({
          path: '/openapi.json',
          allow: 'unauthenticated',
        });
        http.addAuthPolicy({
          path: '/docs',
          allow: 'unauthenticated',
        });
        http.addAuthPolicy({
          path: '/doc',
          allow: 'unauthenticated',
        });
        http.addAuthPolicy({
          path: '/swagger-ui-init.js',
          allow: 'unauthenticated',
        });

        http.use(
          await createRouter({
            logger,
            config,
            discovery,
          }),
        );
      },
    });
  },
});
