import { LoggerService } from '@backstage/backend-plugin-api';

import { agentRegistry } from './registry';
import { ProxyAgentConfig } from './config';
import { AgentActionHandler } from './types';

const joinUrl = (baseUrl: string, endpoint: string): string => {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedEndpoint = endpoint.startsWith('/')
    ? endpoint
    : `/${endpoint}`;
  return `${normalizedBase}${normalizedEndpoint}`;
};

export const loadDynamicAgents = (
  dynamicAgents: ProxyAgentConfig[],
  logger: LoggerService,
) => {
  dynamicAgents.forEach(agent => {
    const handlers: Record<string, AgentActionHandler> = {};

    agent.actions.forEach(action => {
      handlers[action.id] = async request => {
        try {
          const url = joinUrl(agent.baseUrl, action.endpoint);
          const response = await fetch(url, {
            method: action.method,
            headers: {
              'Content-Type': 'application/json',
            },
            ...(action.method === 'POST'
              ? { body: JSON.stringify(request) }
              : {}),
          });

          if (!response.ok) {
            const body = await response.text();
            return {
              status: 'error',
              error: `Dynamic agent call failed (${response.status}): ${body}`,
            };
          }

          const output = await response.json();
          return {
            status: 'ok',
            output,
          };
        } catch (error) {
          logger.error(
            `Dynamic agent action failed: ${agent.id}/${action.id}`,
            error as Error,
          );
          return {
            status: 'error',
            error: (error as Error).message,
          };
        }
      };
    });

    agentRegistry.register(
      {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        version: agent.version,
        actions: agent.actions.map(action => ({
          id: action.id,
          title: action.title,
          description: action.description,
          riskLevel: action.riskLevel,
        })),
        uiExtensions: agent.uiExtensions,
      },
      handlers,
    );

    logger.info(`Registered dynamic agent ${agent.id} from config`);
  });
};
