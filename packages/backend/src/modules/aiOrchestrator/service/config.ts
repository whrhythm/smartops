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
  secretKey?: string;
  apiMode?: 'chat-completions' | 'responses';
  webSearchEnabled?: boolean;
  webSearchMaxKeyword?: number;
};

export type AiAssistantConfig = {
  wecom?: WecomConfig;
  flowable?: FlowableConfig;
  llm?: LlmConfig;
  promptCatalogPath?: string;
  modelProfilesPath?: string;
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
  const parseBoolean = (value: string | undefined): boolean | undefined => {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }

    return undefined;
  };

  const parseNumber = (value: string | undefined): number | undefined => {
    if (value === undefined || value.trim() === '') {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
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
        secretKey: aiConfig.getOptionalString('llm.secretKey') ?? undefined,
        apiMode:
          (aiConfig.getOptionalString('llm.apiMode') as
            | 'chat-completions'
            | 'responses'
            | undefined) ?? undefined,
        webSearchEnabled: parseBoolean(
          aiConfig.getOptionalString('llm.webSearchEnabled') ?? undefined,
        ),
        webSearchMaxKeyword: parseNumber(
          aiConfig.getOptionalString('llm.webSearchMaxKeyword') ?? undefined,
        ),
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
    promptCatalogPath:
      aiConfig.getOptionalString('promptCatalogPath') ?? undefined,
    modelProfilesPath:
      aiConfig.getOptionalString('modelProfilesPath') ?? undefined,
    rag,
    users,
    mcpServers,
    unauthorizedReply,
  };
};
