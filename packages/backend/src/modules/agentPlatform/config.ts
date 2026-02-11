import { Config } from '@backstage/config';

import { AgentRiskLevel, AgentUiExtension } from './types';

type ProxyActionConfig = {
  id: string;
  title: string;
  description?: string;
  riskLevel: AgentRiskLevel;
  method: 'GET' | 'POST';
  endpoint: string;
};

export type ProxyAgentConfig = {
  id: string;
  name: string;
  description?: string;
  version: string;
  baseUrl: string;
  actions: ProxyActionConfig[];
  uiExtensions: AgentUiExtension[];
};

export const readProxyAgentsConfig = (config: Config): ProxyAgentConfig[] => {
  const agentsConfig = config.getOptionalConfigArray('smartops.agents.dynamic');
  if (!agentsConfig || agentsConfig.length === 0) {
    return [];
  }

  return agentsConfig.map(agentConfig => {
    const actions =
      agentConfig.getOptionalConfigArray('actions')?.map(action => ({
        id: action.getString('id'),
        title: action.getString('title'),
        description: action.getOptionalString('description'),
        riskLevel: (action.getOptionalString('riskLevel') ?? 'low') as AgentRiskLevel,
        method: (action.getOptionalString('method') ?? 'POST') as 'GET' | 'POST',
        endpoint: action.getString('endpoint'),
      })) ?? [];

    const uiExtensions =
      agentConfig.getOptionalConfigArray('uiExtensions')?.map(ui => ({
        id: ui.getString('id'),
        title: ui.getString('title'),
        placement: 'settings' as const,
        description: ui.getOptionalString('description'),
      })) ?? [];

    return {
      id: agentConfig.getString('id'),
      name: agentConfig.getString('name'),
      description: agentConfig.getOptionalString('description'),
      version: agentConfig.getOptionalString('version') ?? '0.1.0',
      baseUrl: agentConfig.getString('baseUrl'),
      actions,
      uiExtensions,
    };
  });
};
