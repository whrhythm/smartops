import express from 'express';
import { Config } from '@backstage/config';
import { DiscoveryService, LoggerService } from '@backstage/backend-plugin-api';

import { readAiAssistantConfig } from './config';
import { startFlowableApproval } from './flowable';
import {
  checkLlmProviderHealth,
  generateAgentExecutionReply,
  generateAssistantReply,
  inferActionPlanFromLlm,
  loadLlmClient,
} from './llm';
import { fetchRagContext } from './rag';
import { executeMcpAction } from './mcp';
import { sendWecomText } from './wecom';
import { AiActionPlan, AiMessageEvent } from './types';
import { runWithSpan, withRouteSpan } from '../../observability/httpTracing';
import { renderSwaggerUi } from '../../openapi/swaggerUi';

type RouterOptions = {
  logger: LoggerService;
  config: Config;
  discovery: DiscoveryService;
};

const detectActionPlan = (text: string): AiActionPlan => {
  const lower = text.toLowerCase();
  const isK8s = lower.includes('k8s') || text.includes('集群') || text.includes('节点');
  const isVm = lower.includes('vm') || text.includes('虚拟机');
  const highRisk =
    text.includes('扩容') ||
    text.includes('缩容') ||
    text.includes('删除') ||
    text.includes('生产') ||
    text.includes('回滚');

  return {
    domain: isK8s ? 'k8s' : isVm ? 'vm' : 'unknown',
    requiresApproval: highRisk,
    reason: highRisk ? '高风险操作，需要审批' : '低风险操作',
  };
};

const writeStreamLine = (
  res: express.Response,
  payload: Record<string, unknown>,
) => {
  res.write(`${JSON.stringify(payload)}\n`);
};

const chunkText = (text: string, size = 24) => {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
};

const aiAssistantOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AI Assistant Orchestrator API',
    version: '0.1.0',
    description:
      'LLM-driven agent orchestration endpoints including chat execution and WeCom event handling.',
  },
  components: {
    schemas: {
      AiChatRequest: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          tenantId: { type: 'string' },
          userRef: { type: 'string' },
          autoExecute: { type: 'boolean' },
        },
      },
      WeComMessageRequest: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          phone: { type: 'string' },
          channelUserId: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/ai-assistant/health': {
      get: {
        summary: 'Health check and LLM config status',
        responses: {
          '200': { description: 'Assistant health' },
        },
      },
    },
    '/ai-assistant/providers/health': {
      get: {
        summary: 'Check configured LLM provider connectivity and latency',
        responses: {
          '200': { description: 'Provider health result' },
          '503': { description: 'LLM not configured' },
        },
      },
    },
    '/ai-assistant/chat': {
      post: {
        summary: 'Chat with assistant and optionally auto-execute selected action',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiChatRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Assistant response and optional execution result' },
          '400': { description: 'Missing text or invalid request' },
          '503': { description: 'LLM not configured' },
        },
      },
    },
    '/ai-assistant/chat/stream': {
      post: {
        summary: 'Stream assistant response chunks in NDJSON format',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiChatRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Stream started' },
          '400': { description: 'Missing text or invalid request' },
          '503': { description: 'LLM not configured' },
        },
      },
    },
    '/ai-assistant/wecom/messages': {
      post: {
        summary: 'Handle WeCom inbound assistant events',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WeComMessageRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Event handled' },
          '400': { description: 'Missing text' },
        },
      },
    },
  },
};

export const createRouter = async ({ logger, config, discovery }: RouterOptions) => {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/openapi.json', (_, res) => {
    res.json(aiAssistantOpenApiSpec);
  });

  router.get('/docs', (_, res) => {
    res.type('html').send(renderSwaggerUi('AI Assistant API Docs', './openapi.json'));
  });

  const aiConfig = readAiAssistantConfig(config);
  const llmClient = loadLlmClient(aiConfig.llm, logger);

  router.get('/ai-assistant/health', withRouteSpan('ai-assistant.health', (_, res) => {
    res.json({
      status: 'ok',
      llmConfigured: !!llmClient,
    });
  }));

  router.get('/ai-assistant/providers/health', withRouteSpan('ai-assistant.providers.health', async (_, res) => {
    if (!llmClient) {
      res.status(503).json({
        ok: false,
        error: 'LLM is not configured',
      });
      return;
    }

    const health = await checkLlmProviderHealth(llmClient);
    res.status(health.ok ? 200 : 502).json(health);
  }));

  router.post('/ai-assistant/chat', withRouteSpan('ai-assistant.chat', async (req, res) => {
    const body = req.body as {
      text?: string;
    };

    if (!body?.text?.trim()) {
      res.status(400).json({ error: 'Missing text' });
      return;
    }

    if (!llmClient) {
      res.status(503).json({ error: 'LLM is not configured' });
      return;
    }

    const traceId = req.header('x-trace-id') ?? undefined;
    const text = body.text.trim();

    // NOTE: Agents are intentionally not invoked for now.
    // This endpoint is kept in pure LLM mode until agent workflows are ready.
    const reply = await runWithSpan(
      'ai-assistant.verify.reply',
      async () =>
        generateAgentExecutionReply(llmClient, {
          userInput: text,
          intent: null,
          availableAgents: [],
        }),
      {
        attributes: {
          'smartops.phase': 'verify',
          'smartops.trace_id': traceId,
        },
      },
    );

    res.json({
      reply,
      selectedAction: null,
      execution: null,
    });
  }));

  router.post('/ai-assistant/chat/stream', withRouteSpan('ai-assistant.chat.stream', async (req, res) => {
    const body = req.body as {
      text?: string;
    };

    if (!body?.text?.trim()) {
      res.status(400).json({ error: 'Missing text' });
      return;
    }

    if (!llmClient) {
      res.status(503).json({ error: 'LLM is not configured' });
      return;
    }

    const traceId = req.header('x-trace-id') ?? undefined;
    const text = body.text.trim();

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    writeStreamLine(res, { type: 'start' });

    try {
      // NOTE: Agents are intentionally not invoked for now.
      // Streaming chat is pure LLM output until agent readiness is complete.
      const reply = await runWithSpan(
        'ai-assistant.verify.reply.stream',
        async () =>
          generateAgentExecutionReply(llmClient, {
            userInput: text,
            intent: null,
            availableAgents: [],
          }),
        {
          attributes: {
            'smartops.phase': 'verify',
            'smartops.trace_id': traceId,
          },
        },
      );

      for (const chunk of chunkText(reply)) {
        writeStreamLine(res, { type: 'delta', content: chunk });
      }

      writeStreamLine(res, {
        type: 'done',
        reply,
        selectedAction: null,
        execution: null,
      });
    } catch (error) {
      writeStreamLine(res, {
        type: 'error',
        error: (error as Error).message,
      });
    }

    res.end();
  }));

  router.post('/ai-assistant/wecom/messages', withRouteSpan('ai-assistant.wecom.messages', async (req, res) => {
    const event = req.body as AiMessageEvent;
    if (!event?.text) {
      res.status(400).json({ error: 'Missing text' });
      return;
    }

    const user = aiConfig.users.find(
      u => u.phone === event.phone || u.wecomUserId === event.channelUserId,
    );

    if (!user) {
      if (aiConfig.wecom) {
        await sendWecomText(
          aiConfig.wecom,
          event.channelUserId,
          aiConfig.unauthorizedReply,
        );
      }
      res.json({ status: 'unauthorized' });
      return;
    }

    const ragContext = await fetchRagContext({
      discovery,
      query: event.text,
      logger,
      maxResults: aiConfig.rag?.maxResults ?? 3,
      tenantId: user.tenantId,
      tenantFilterKey: aiConfig.rag?.tenantFilterKey ?? 'tenantId',
    });
    const llmPlan = llmClient
      ? await inferActionPlanFromLlm(llmClient, event.text, logger)
      : null;
    const plan: AiActionPlan = llmPlan ?? detectActionPlan(event.text);

    if (plan.requiresApproval) {
      if (!aiConfig.flowable) {
        const reply = '审批系统未配置，无法执行该操作。';
        if (aiConfig.wecom) {
          await sendWecomText(
            aiConfig.wecom,
            user.wecomUserId ?? event.channelUserId,
            reply,
          );
        }
        res.json({ status: 'approval_missing' });
        return;
      }

      await startFlowableApproval(aiConfig.flowable, {
        businessKey: `${user.userRef}:${Date.now()}`,
        payload: {
          tenantId: user.tenantId,
          userRef: user.userRef,
          input: event.text,
          domain: plan.domain,
        },
      });

      const aiReply = llmClient
        ? await generateAssistantReply(llmClient, event.text, ragContext, plan)
        : null;
      const reply = aiReply
        ? `${aiReply}\n\n已提交审批：${plan.reason}。审批通过后将自动执行。`
        : `已提交审批：${plan.reason}。审批通过后将自动执行。`;
      if (aiConfig.wecom) {
        await sendWecomText(
          aiConfig.wecom,
          user.wecomUserId ?? event.channelUserId,
          reply,
        );
      }
      res.json({ status: 'approval_requested' });
      return;
    }

    const server = aiConfig.mcpServers.find(s => s.domain === plan.domain);
    if (!server) {
      const reply = '未找到对应的执行工具，请联系管理员配置。';
      if (aiConfig.wecom) {
        await sendWecomText(
          aiConfig.wecom,
          user.wecomUserId ?? event.channelUserId,
          reply,
        );
      }
      res.json({ status: 'mcp_missing' });
      return;
    }

    try {
      const result = await executeMcpAction(server, {
        tenantId: user.tenantId,
        userRef: user.userRef,
        input: event.text,
      });

      const aiReply = llmClient
        ? await generateAssistantReply(llmClient, event.text, ragContext, plan, result)
        : null;
      const reply = aiReply
        ? `${aiReply}\n\n执行结果：${JSON.stringify(result)}`
        : `已执行：${JSON.stringify(result)}`;
      if (aiConfig.wecom) {
        await sendWecomText(
          aiConfig.wecom,
          user.wecomUserId ?? event.channelUserId,
          reply,
        );
      }
      res.json({ status: 'executed', result });
    } catch (error) {
      logger.error('MCP execution failed', error as Error);
      const reply = '执行失败，请稍后重试或联系管理员。';
      if (aiConfig.wecom) {
        await sendWecomText(
          aiConfig.wecom,
          user.wecomUserId ?? event.channelUserId,
          reply,
        );
      }
      res.status(500).json({ status: 'failed' });
    }
  }));

  return router;
};
