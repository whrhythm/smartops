import { Config } from '@backstage/config';

export type WecomConfig = {
  corpId: string;
  agentId: string;
  secret: string;
};

export type FlowableConfig = {
  baseUrl: string;
  username: string;
  password: string;
  processKey: string;
};

export type McpServerConfig = {
  name: string;
  domain: 'k8s' | 'vm' | 'approval' | 'unknown';
  baseUrl: string;
};

export type AiUserMapping = {
  phone: string;
  tenantId: string;
  userRef: string;
  wecomUserId?: string;
};

export type LlmConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AiAssistantConfig = {
  wecom?: WecomConfig;
  flowable?: FlowableConfig;
  llm?: LlmConfig;
  rag?: {
    tenantFilterKey?: string;
    maxResults?: number;
  };
  users: AiUserMapping[];
  mcpServers: McpServerConfig[];
  unauthorizedReply: string;
};

export const readAiAssistantConfig = (config: Config): AiAssistantConfig => {
  const aiConfig = config.getConfig('aiAssistant');
  const users = aiConfig.getConfigArray('users').map(userConfig => ({
    phone: userConfig.getString('phone'),
    tenantId: userConfig.getString('tenantId'),
    userRef: userConfig.getString('userRef'),
    wecomUserId: userConfig.getOptionalString('wecomUserId') ?? undefined,
  }));

  const mcpServers = aiConfig.getConfigArray('mcpServers').map(server => ({
    name: server.getString('name'),
    domain: server.getString('domain') as McpServerConfig['domain'],
    baseUrl: server.getString('baseUrl'),
  }));

  const wecom = aiConfig.has('wecom')
    ? {
        corpId: aiConfig.getString('wecom.corpId'),
        agentId: aiConfig.getString('wecom.agentId'),
        secret: aiConfig.getString('wecom.secret'),
      }
    : undefined;

  const flowable = aiConfig.has('flowable')
    ? {
        baseUrl: aiConfig.getString('flowable.baseUrl'),
        username: aiConfig.getString('flowable.username'),
        password: aiConfig.getString('flowable.password'),
        processKey: aiConfig.getString('flowable.processKey'),
      }
    : undefined;

  const llm = aiConfig.has('llm')
    ? {
        provider: aiConfig.getString('llm.provider'),
        baseUrl: aiConfig.getString('llm.baseUrl'),
        apiKey: aiConfig.getString('llm.apiKey'),
        model: aiConfig.getString('llm.model'),
      }
    : undefined;

  const rag = aiConfig.has('rag')
    ? {
        tenantFilterKey: aiConfig.getOptionalString('rag.tenantFilterKey') ?? undefined,
        maxResults: aiConfig.getOptionalNumber('rag.maxResults') ?? undefined,
      }
    : undefined;

  const unauthorizedReply =
    aiConfig.getOptionalString('unauthorizedReply') ??
    '抱歉，你暂未开通权限，请联系管理员申请访问。';

  return {
    wecom,
    flowable,
    llm,
    rag,
    users,
    mcpServers,
    unauthorizedReply,
  };
};
