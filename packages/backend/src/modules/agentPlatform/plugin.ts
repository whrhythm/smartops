import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';

import { readProxyAgentsConfig } from './config';
import { loadDynamicAgents } from './loadDynamicAgents';
import { createRouter } from './router';
import { createEventPublisher } from './events/publisher';
import { createTaskStore } from './taskStore';

export const agentPlatformBackend = createBackendPlugin({
  pluginId: 'agent-platform',
  register(env) {
    env.registerInit({
      deps: {
        http: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
      },
      async init({ http, logger, config, database }) {
        const dynamicAgents = readProxyAgentsConfig(config);
        loadDynamicAgents(dynamicAgents, logger);
        const eventPublisher = createEventPublisher(config, logger);
        const taskStore = await createTaskStore(database, logger);

        http.addAuthPolicy({
          path: '/openapi.json',
          allow: 'unauthenticated',
        });
        http.addAuthPolicy({
          path: '/docs',
          allow: 'unauthenticated',
        });
        http.addAuthPolicy({
          path: '/swagger-ui-init.js',
          allow: 'unauthenticated',
        });

        http.use(
          await createRouter({
            logger,
            eventPublisher,
            taskStore,
          }),
        );
      },
    });
  },
});
