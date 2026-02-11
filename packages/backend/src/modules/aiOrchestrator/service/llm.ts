import { LoggerService } from '@backstage/backend-plugin-api';

import { AiActionPlan } from './types';

import { LlmConfig } from './config';
import { AgentDefinition, AgentRiskLevel } from '../../agentPlatform';
import { createLlmProviderAdapter, LlmProviderAdapter } from './providers';

export type LlmClient = {
  provider: string;
  model: string;
  adapter: LlmProviderAdapter;
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
  llm: LlmConfig | undefined,
  logger: LoggerService,
): LlmClient | null => {
  if (!llm) {
    logger.warn('aiAssistant.llm is not configured');
    return null;
  }

  logger.info(
    `AI LLM configured: provider=${llm.provider}, baseUrl=${llm.baseUrl}, model=${llm.model}`,
  );

  const adapter = createLlmProviderAdapter(
    {
      provider: llm.provider,
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
    },
    logger,
  );

  return {
    provider: llm.provider,
    model: llm.model,
    adapter,
  };
};

export const checkLlmProviderHealth = async (
  client: LlmClient,
): Promise<LlmProviderHealth> => {
  const startedAt = Date.now();
  try {
    const text = await client.adapter.generateText({
      system:
        'You are a health check responder. Reply with exactly: OK. Do not add extra words.',
      prompt: 'Health check',
      temperature: 0,
    });

    return {
      ok: true,
      provider: client.provider,
      model: client.model,
      latencyMs: Date.now() - startedAt,
      outputPreview: text.slice(0, 64),
    };
  } catch (error) {
    return {
      ok: false,
      provider: client.provider,
      model: client.model,
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
    const text = await client.adapter.generateText({
      system:
        'You are an ops assistant. Return only JSON with keys: domain (k8s|vm|unknown), requiresApproval (boolean), reason (string). Set requiresApproval=true for scaling, deletion, or production changes.',
      prompt: input,
      temperature: 0.1,
    });

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
  const system =
    'You are an ops assistant. Reply in concise Chinese. Use the provided context when relevant. If approval is required, explain that approval is needed. If executionResult exists, summarize it.';

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

  const text = await client.adapter.generateText({
    system,
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

    const raw = await client.adapter.generateText({
      temperature: 0,
      system:
        'You are a strict orchestration planner. Return only JSON with keys: agentId, actionId, reason, input. Select only from provided actions. If no action should be executed, return {"agentId":"","actionId":"","reason":"no-op","input":{}}.',
      prompt: `User request:\n${input}\n\nAvailable actions:\n${availableActions}`,
    });

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
  const text = await client.adapter.generateText({
    system:
      'You are an enterprise SmartOps assistant. Reply in concise Chinese. If no action is chosen, propose one next best step. If approval is needed, clearly ask for approval.',
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
