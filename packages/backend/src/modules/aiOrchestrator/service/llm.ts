import { LoggerService } from '@backstage/backend-plugin-api';

import { AiActionPlan } from './types';

import { AiAssistantConfig } from './config';
import { AgentDefinition, AgentRiskLevel } from '../../agentPlatform';
import { createLlmProviderAdapter, LlmProviderAdapter } from './providers';
import { loadPromptCatalog, PromptCatalog, PromptTaskType } from './promptCatalog';
import { loadModelProfiles, ResolvedModelProfile } from './modelProfiles';

export type LlmClient = {
  logger: LoggerService;
  prompts: PromptCatalog;
  profiles: Record<string, ResolvedModelProfile>;
  routing: Record<PromptTaskType, string>;
  adapterCache: Map<string, LlmProviderAdapter>;
};

export type LlmProviderHealth = {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  outputPreview?: string;
  error?: string;
};

export const loadLlmClient = (
  aiConfig: AiAssistantConfig,
  logger: LoggerService,
): LlmClient | null => {
  const llm = aiConfig.llm;
  if (!llm) {
    logger.warn('aiAssistant.llm is not configured');
    return null;
  }

  const prompts = loadPromptCatalog(aiConfig.promptCatalogPath, logger);
  const modelProfiles = loadModelProfiles(aiConfig.modelProfilesPath, llm, logger);
  const healthProfile =
    modelProfiles.profiles[modelProfiles.routing.health_check] ??
    Object.values(modelProfiles.profiles)[0];

  logger.info(
    `AI LLM configured: provider=${healthProfile.provider}, baseUrl=${healthProfile.baseUrl}, model=${healthProfile.model}`,
  );

  return {
    logger,
    prompts,
    profiles: modelProfiles.profiles,
    routing: modelProfiles.routing,
    adapterCache: new Map<string, LlmProviderAdapter>(),
  };
};

const resolveProfileForTask = (
  client: LlmClient,
  task: PromptTaskType,
): ResolvedModelProfile => {
  const profileId = client.routing[task];
  return client.profiles[profileId] ?? client.profiles.default;
};

const getAdapterForTask = (
  client: LlmClient,
  task: PromptTaskType,
) => {
  const profile = resolveProfileForTask(client, task);
  const cacheKey = profile.id;

  const cached = client.adapterCache.get(cacheKey);
  if (cached) {
    return {
      profile,
      adapter: cached,
    };
  }

  const adapter = createLlmProviderAdapter(
    {
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      secretKey: profile.secretKey,
      apiMode: profile.apiMode,
      webSearchEnabled: profile.webSearchEnabled,
      webSearchMaxKeyword: profile.webSearchMaxKeyword,
    },
    client.logger,
  );

  client.adapterCache.set(cacheKey, adapter);
  return {
    profile,
    adapter,
  };
};

const generateTextWithTask = async (
  client: LlmClient,
  options: {
    task: PromptTaskType;
    prompt: string;
    temperature?: number;
  },
) => {
  const { adapter } = getAdapterForTask(client, options.task);
  return adapter.generateText({
    system: client.prompts[options.task],
    prompt: options.prompt,
    temperature: options.temperature,
  });
};

export const checkLlmProviderHealth = async (
  client: LlmClient,
): Promise<LlmProviderHealth> => {
  const startedAt = Date.now();
  try {
    const { profile } = getAdapterForTask(client, 'health_check');
    const text = await generateTextWithTask(client, {
      task: 'health_check',
      prompt: 'Health check',
      temperature: 0,
    });

    return {
      ok: true,
      provider: profile.provider,
      model: profile.model,
      latencyMs: Date.now() - startedAt,
      outputPreview: text.slice(0, 64),
    };
  } catch (error) {
    const { profile } = getAdapterForTask(client, 'health_check');
    return {
      ok: false,
      provider: profile.provider,
      model: profile.model,
      latencyMs: Date.now() - startedAt,
      error: (error as Error).message,
    };
  }
};

export const inferActionPlanFromLlm = async (
  client: LlmClient,
  input: string,
  logger: LoggerService,
): Promise<AiActionPlan | null> => {
  try {
    const text = await generateTextWithTask(
      client,
      {
        task: 'action_plan',
        prompt: input,
        temperature: 0.1,
      },
    );

    if (!text) {
      return null;
    }

    const parsed = JSON.parse(text) as {
      domain?: string;
      requiresApproval?: boolean;
      reason?: string;
    };

    if (!parsed.domain || typeof parsed.requiresApproval !== 'boolean') {
      return null;
    }

    const domain: AiActionPlan['domain'] =
      parsed.domain === 'k8s' || parsed.domain === 'vm'
        ? parsed.domain
        : 'unknown';

    return {
      domain,
      requiresApproval: parsed.requiresApproval,
      reason: parsed.reason ?? 'LLM decision',
    };
  } catch (error) {
    logger.warn(`LLM inference failed: ${(error as Error).message}`);
    return null;
  }
};

export const generateAssistantReply = async (
  client: LlmClient,
  input: string,
  ragContext: string,
  plan: AiActionPlan,
  executionResult?: unknown,
) => {
  const promptParts = [
    `User: ${input}`,
    `Plan: domain=${plan.domain}, requiresApproval=${plan.requiresApproval}, reason=${plan.reason}`,
  ];

  if (ragContext) {
    promptParts.push(`Context:\n${ragContext}`);
  }

  if (executionResult) {
    promptParts.push(`ExecutionResult: ${JSON.stringify(executionResult)}`);
  }

  const text = await generateTextWithTask(client, {
    task: 'assistant_reply',
    prompt: promptParts.join('\n\n'),
    temperature: 0.2,
  });

  return text;
};

export type AgentExecutionIntent = {
  agentId: string;
  actionId: string;
  reason: string;
  input: Record<string, unknown>;
};

type LlmAgentIntent = {
  agentId?: string;
  actionId?: string;
  reason?: string;
  input?: Record<string, unknown>;
};

const fallbackIntent = (
  input: string,
  agents: AgentDefinition[],
): AgentExecutionIntent | null => {
  const normalized = input.toLowerCase();
  const k8sAgent = agents.find(agent => agent.id === 'kubernetes');
  if (!k8sAgent) {
    return null;
  }

  if (
    normalized.includes('k8s') ||
    input.includes('集群') ||
    input.includes('节点')
  ) {
    const action = k8sAgent.actions.find(item => item.id === 'list-resources');
    if (!action) {
      return null;
    }
    return {
      agentId: k8sAgent.id,
      actionId: action.id,
      reason: 'Fallback intent matched Kubernetes read operation',
      input: {
        kind: 'Node',
      },
    };
  }

  if (normalized.includes('扩容') || normalized.includes('scale')) {
    const action = k8sAgent.actions.find(item => item.id === 'scale-workload');
    if (!action) {
      return null;
    }
    return {
      agentId: k8sAgent.id,
      actionId: action.id,
      reason: 'Fallback intent matched Kubernetes scale operation',
      input: {
        kind: 'Deployment',
        name: 'web',
        replicas: 3,
      },
    };
  }

  return null;
};

const getActionRiskLevel = (
  agents: AgentDefinition[],
  agentId: string,
  actionId: string,
): AgentRiskLevel | null => {
  const agent = agents.find(item => item.id === agentId);
  const action = agent?.actions.find(item => item.id === actionId);
  return action?.riskLevel ?? null;
};

export const inferAgentExecutionIntent = async (
  client: LlmClient,
  input: string,
  agents: AgentDefinition[],
  logger: LoggerService,
): Promise<AgentExecutionIntent | null> => {
  if (agents.length === 0) {
    return null;
  }

  try {
    const availableActions = agents
      .map(agent => ({
        id: agent.id,
        actions: agent.actions.map(action => ({
          id: action.id,
          riskLevel: action.riskLevel,
          inputExample: action.inputExample ?? {},
        })),
      }))
      .map(item => JSON.stringify(item))
      .join('\n');

    const raw = await generateTextWithTask(
      client,
      {
        task: 'agent_intent',
        prompt: `User request:\n${input}\n\nAvailable actions:\n${availableActions}`,
        temperature: 0,
      },
    );

    if (!raw) {
      return fallbackIntent(input, agents);
    }

    const parsed = JSON.parse(raw) as LlmAgentIntent;
    if (!parsed.agentId || !parsed.actionId) {
      return fallbackIntent(input, agents);
    }

    const riskLevel = getActionRiskLevel(agents, parsed.agentId, parsed.actionId);
    if (!riskLevel) {
      return fallbackIntent(input, agents);
    }

    return {
      agentId: parsed.agentId,
      actionId: parsed.actionId,
      reason: parsed.reason ?? 'LLM selected this action',
      input: parsed.input ?? {},
    };
  } catch (error) {
    logger.warn(`LLM agent intent inference failed: ${(error as Error).message}`);
    return fallbackIntent(input, agents);
  }
};

export const generateAgentExecutionReply = async (
  client: LlmClient,
  options: {
    userInput: string;
    intent: AgentExecutionIntent | null;
    executionResult?: unknown;
    requiresApproval?: boolean;
    availableAgents: AgentDefinition[];
  },
) => {
  const text = await generateTextWithTask(client, {
    task: 'agent_execution_reply',
    prompt: [
      `User input: ${options.userInput}`,
      `Intent: ${JSON.stringify(options.intent ?? null)}`,
      `Requires approval: ${Boolean(options.requiresApproval)}`,
      `Execution result: ${JSON.stringify(options.executionResult ?? null)}`,
      `Available agents: ${JSON.stringify(options.availableAgents.map(agent => ({ id: agent.id, actions: agent.actions.map(action => action.id) })))} `,
    ].join('\n\n'),
    temperature: 0.2,
  });

  return text;
};
