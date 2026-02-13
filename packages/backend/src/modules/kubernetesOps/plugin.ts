import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { readKubernetesOpsConfig } from './config';
import { createRouter } from './router';

export const kubernetesOpsBackend = createBackendPlugin({
  pluginId: 'kubernetes-ops',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ http, logger, config }) {
        http.addAuthPolicy({ path: '/openapi.json', allow: 'unauthenticated' });
        http.addAuthPolicy({ path: '/docs', allow: 'unauthenticated' });
        http.addAuthPolicy({
          path: '/swagger-ui-init.js',
          allow: 'unauthenticated',
        });

        http.use(
          await createRouter({
            logger,
            config: readKubernetesOpsConfig(config),
          }),
        );
      },
    });
  },
});
