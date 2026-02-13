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
import { renderSwaggerUi, renderSwaggerUiInitScript } from '../../openapi/swaggerUi';

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
    version: '0.2.0',
    description:
      'SmartOps assistant APIs for health checks, synchronous chat, NDJSON streaming chat, and WeCom inbound message handling.',
  },
  tags: [
    { name: 'health', description: 'Service and provider health endpoints' },
    { name: 'chat', description: 'Assistant chat endpoints' },
    { name: 'wecom', description: 'WeCom integration endpoints' },
  ],
  components: {
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Missing text' },
        },
        required: ['error'],
      },
      AiChatRequest: {
        type: 'object',
        required: ['text'],
        properties: {
          text: {
            type: 'string',
            description: 'User input text sent to the assistant',
            example: '检查今天生产集群节点状态',
          },
          tenantId: {
            type: 'string',
            description: 'Optional tenant context (currently reserved)',
            example: 'tenant-a',
          },
          userRef: {
            type: 'string',
            description: 'Optional user reference (currently reserved)',
            example: 'user:default/alice',
          },
          autoExecute: {
            type: 'boolean',
            description: 'Reserved for future action auto-execution support',
            example: false,
          },
        },
      },
      ChatResponse: {
        type: 'object',
        properties: {
          reply: {
            type: 'string',
            description: 'Assistant generated reply',
            example: '当前集群运行正常，未发现异常节点。',
          },
          selectedAction: {
            nullable: true,
            description: 'Reserved field for selected action metadata',
            oneOf: [{ type: 'object' }, { type: 'null' }],
          },
          execution: {
            nullable: true,
            description: 'Reserved field for action execution result',
            oneOf: [{ type: 'object' }, { type: 'null' }],
          },
        },
        required: ['reply', 'selectedAction', 'execution'],
      },
      ProviderHealthResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          provider: { type: 'string', example: 'volcengine' },
          model: { type: 'string', example: 'doubao-seed-1-8-251228' },
          latencyMs: { type: 'number', example: 128 },
          outputPreview: { type: 'string', example: 'OK' },
          error: {
            type: 'string',
            nullable: true,
            example: 'Provider timeout',
          },
        },
        required: ['ok', 'provider', 'model', 'latencyMs'],
      },
      AssistantHealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          llmConfigured: { type: 'boolean', example: true },
        },
        required: ['status', 'llmConfigured'],
      },
      WeComMessageRequest: {
        type: 'object',
        required: ['text'],
        properties: {
          text: {
            type: 'string',
            description: 'Inbound user message from WeCom',
            example: '帮我看下今天的热点告警',
          },
          phone: {
            type: 'string',
            description: 'Optional user phone for mapping',
            example: '13800138000',
          },
          channelUserId: {
            type: 'string',
            description: 'WeCom user id',
            example: 'zhangsan',
          },
        },
      },
      WeComMessageResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              'Processing status: unauthorized | approval_missing | approval_requested | mcp_missing | executed',
            example: 'approval_requested',
          },
          reply: {
            type: 'string',
            nullable: true,
            description: 'Optional generated reply',
          },
        },
        required: ['status'],
      },
      StreamStartEvent: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['start'] },
        },
        required: ['type'],
      },
      StreamDeltaEvent: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['delta'] },
          content: { type: 'string', example: '当前集群' },
        },
        required: ['type', 'content'],
      },
      StreamDoneEvent: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['done'] },
          reply: {
            type: 'string',
            example: '当前集群运行正常，未发现异常节点。',
          },
          selectedAction: {
            nullable: true,
            oneOf: [{ type: 'object' }, { type: 'null' }],
          },
          execution: {
            nullable: true,
            oneOf: [{ type: 'object' }, { type: 'null' }],
          },
        },
        required: ['type', 'reply', 'selectedAction', 'execution'],
      },
      StreamErrorEvent: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['error'] },
          error: { type: 'string', example: 'LLM service unavailable' },
        },
        required: ['type', 'error'],
      },
    },
  },
  paths: {
    '/ai-assistant/health': {
      get: {
        tags: ['health'],
        summary: 'Assistant service health',
        description: 'Returns basic service health and whether LLM is configured.',
        responses: {
          '200': {
            description: 'Assistant health result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AssistantHealthResponse' },
              },
            },
          },
        },
      },
    },
    '/ai-assistant/providers/health': {
      get: {
        tags: ['health'],
        summary: 'LLM provider health check',
        description:
          'Checks upstream model provider connectivity and returns latency/preview.',
        responses: {
          '200': {
            description: 'Provider is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProviderHealthResponse' },
              },
            },
          },
          '502': {
            description: 'Provider check failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProviderHealthResponse' },
              },
            },
          },
          '503': {
            description: 'LLM is not configured',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/ai-assistant/chat': {
      post: {
        tags: ['chat'],
        summary: 'Synchronous assistant chat',
        description:
          'Returns one complete assistant reply. Current behavior is pure LLM generation without agent execution.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiChatRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Assistant response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatResponse' },
              },
            },
          },
          '400': {
            description: 'Missing text or invalid body',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '503': {
            description: 'LLM not configured',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/ai-assistant/chat/stream': {
      post: {
        tags: ['chat'],
        summary: 'Streaming assistant chat (NDJSON)',
        description:
          'Streams newline-delimited JSON events. Event sequence is start -> delta* -> done, or start -> error.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiChatRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'NDJSON stream',
            content: {
              'application/x-ndjson': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/StreamStartEvent' },
                    { $ref: '#/components/schemas/StreamDeltaEvent' },
                    { $ref: '#/components/schemas/StreamDoneEvent' },
                    { $ref: '#/components/schemas/StreamErrorEvent' },
                  ],
                },
                examples: {
                  streamSample: {
                    summary: 'Example NDJSON event sequence',
                    value:
                      '{"type":"start"}\n{"type":"delta","content":"当前集群"}\n{"type":"delta","content":"运行正常"}\n{"type":"done","reply":"当前集群运行正常","selectedAction":null,"execution":null}',
                  },
                },
              },
            },
          },
          '400': {
            description: 'Missing text or invalid body',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '503': {
            description: 'LLM not configured',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/ai-assistant/wecom/messages': {
      post: {
        tags: ['wecom'],
        summary: 'Handle WeCom inbound assistant event',
        description:
          'Maps WeCom user context, performs planning/execution path, and optionally sends back WeCom reply.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WeComMessageRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Event handled',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WeComMessageResponse' },
              },
            },
          },
          '400': {
            description: 'Missing text',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
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

  router.get('/doc', (_, res) => {
    res.type('html').send(renderSwaggerUi('AI Assistant API Docs', './openapi.json'));
  });

  router.get('/swagger-ui-init.js', (_, res) => {
    res.type('application/javascript').send(renderSwaggerUiInitScript());
  });

  const aiConfig = readAiAssistantConfig(config);
  const llmClient = loadLlmClient(aiConfig, logger);

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
