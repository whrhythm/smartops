import express from 'express';

import { LoggerService } from '@backstage/backend-plugin-api';

import { agentRegistry } from './registry';
import { AgentExecuteRequest } from './types';
import { EventPublisher } from './events/publisher';
import { AgentEventTopics } from './events/topics';
import { runWithSpan, withRouteSpan } from '../observability/httpTracing';
import { TaskStore } from './taskStore';
import { approvalDecisionInputSchema } from './contracts/approvalContract';
import { renderSwaggerUi } from '../openapi/swaggerUi';

const parseTaskStatus = (value?: string) => {
  const allowed = [
    'planned',
    'running',
    'approval_required',
    'approved',
    'rejected',
    'succeeded',
    'failed',
    'cancelled',
  ] as const;
  if (!value || !allowed.includes(value as (typeof allowed)[number])) {
    return undefined;
  }
  return value as (typeof allowed)[number];
};

const parseApprovalStatus = (value?: string) => {
  const allowed = ['pending', 'approved', 'rejected', 'expired'] as const;
  if (!value || !allowed.includes(value as (typeof allowed)[number])) {
    return undefined;
  }
  return value as (typeof allowed)[number];
};

type RouterOptions = {
  logger: LoggerService;
  eventPublisher: EventPublisher;
  taskStore: TaskStore;
};

const newEventId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const agentPlatformOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Agent Platform API',
    version: '0.1.0',
    description:
      'AI-driven agent registry, action execution, approval workflow, and task tracking APIs.',
  },
  components: {
    schemas: {
      AgentExecuteRequest: {
        type: 'object',
        properties: {
          input: {
            type: 'object',
            additionalProperties: true,
          },
          context: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              userRef: { type: 'string' },
              approval: {
                type: 'object',
                properties: {
                  approved: { type: 'boolean' },
                  ticketId: { type: 'string' },
                  approver: { type: 'string' },
                },
              },
            },
          },
        },
      },
      ApprovalDecisionRequest: {
        type: 'object',
        required: ['decision', 'decidedBy'],
        properties: {
          decision: {
            type: 'string',
            enum: ['approved', 'rejected'],
          },
          decidedBy: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service health',
          },
        },
      },
    },
    '/agents': {
      get: {
        summary: 'List registered agents',
        responses: {
          '200': {
            description: 'Agent definitions',
          },
        },
      },
    },
    '/actions/{agentId}/{actionId}/execute': {
      post: {
        summary: 'Execute an agent action',
        parameters: [
          {
            in: 'path',
            name: 'agentId',
            required: true,
            schema: { type: 'string' },
          },
          {
            in: 'path',
            name: 'actionId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AgentExecuteRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Action executed successfully' },
          '202': { description: 'Approval required for high-risk action' },
          '400': { description: 'Action execution failed' },
          '404': { description: 'Agent or action not found' },
        },
      },
    },
    '/tasks': {
      get: {
        summary: 'List tasks',
        parameters: [
          {
            in: 'query',
            name: 'tenantId',
            schema: { type: 'string' },
          },
          {
            in: 'query',
            name: 'status',
            schema: { type: 'string' },
          },
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          '200': { description: 'Task list' },
        },
      },
    },
    '/tasks/{taskId}': {
      get: {
        summary: 'Get task by id',
        parameters: [
          {
            in: 'path',
            name: 'taskId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Task details' },
          '404': { description: 'Task not found' },
        },
      },
    },
    '/approvals': {
      get: {
        summary: 'List approval tickets',
        parameters: [
          {
            in: 'query',
            name: 'tenantId',
            schema: { type: 'string' },
          },
          {
            in: 'query',
            name: 'status',
            schema: { type: 'string', enum: ['pending', 'approved', 'rejected', 'expired'] },
          },
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          '200': { description: 'Approval ticket list' },
        },
      },
    },
    '/approvals/{ticketId}': {
      get: {
        summary: 'Get approval ticket by id',
        parameters: [
          {
            in: 'path',
            name: 'ticketId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Approval ticket details' },
          '404': { description: 'Ticket not found' },
        },
      },
    },
    '/approvals/{ticketId}/decision': {
      post: {
        summary: 'Approve or reject a ticket and resume execution',
        parameters: [
          {
            in: 'path',
            name: 'ticketId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApprovalDecisionRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Decision persisted and execution handled' },
          '400': { description: 'Invalid decision or execution failure' },
          '404': { description: 'Ticket not found' },
          '500': { description: 'Decision persistence failed' },
        },
      },
    },
  },
};

const readBackupRunId = (result: unknown): string | undefined => {
  const candidate = result as {
    output?: {
      backupRunId?: unknown;
    };
  };

  return typeof candidate?.output?.backupRunId === 'string'
    ? candidate.output.backupRunId
    : undefined;
};

export const createRouter = async ({ logger, eventPublisher, taskStore }: RouterOptions) => {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/openapi.json', (_, res) => {
    res.json(agentPlatformOpenApiSpec);
  });

  router.get('/docs', (_, res) => {
    res.type('html').send(renderSwaggerUi('Agent Platform API Docs', './openapi.json'));
  });

  router.get('/health', withRouteSpan('agent-platform.health', (_, res) => {
    res.json({ status: 'ok' });
  }));

  router.get('/agents', withRouteSpan('agent-platform.agents.list', (_, res) => {
    res.json({ agents: agentRegistry.list() });
  }));

  router.get('/tasks/:taskId', withRouteSpan('agent-platform.tasks.get', async (req, res) => {
    const { taskId } = req.params;
    const task = await taskStore.getTask(taskId);
    if (!task) {
      res.status(404).json({
        status: 'error',
        error: `Task ${taskId} not found`,
      });
      return;
    }

    res.json({
      status: 'ok',
      task,
    });
  }));

  router.get('/tasks', withRouteSpan('agent-platform.tasks.list', async (req, res) => {
    const tasks = await taskStore.listTasks({
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      status: parseTaskStatus(
        req.query.status ? String(req.query.status) : undefined,
      ),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.json({
      status: 'ok',
      tasks,
    });
  }));

  router.get('/approvals/:ticketId', withRouteSpan('agent-platform.approvals.get', async (req, res) => {
    const { ticketId } = req.params;
    const approval = await taskStore.getApprovalTicket(ticketId);
    if (!approval) {
      res.status(404).json({
        status: 'error',
        error: `Approval ticket ${ticketId} not found`,
      });
      return;
    }

    res.json({
      status: 'ok',
      approval,
    });
  }));

  router.get('/approvals', withRouteSpan('agent-platform.approvals.list', async (req, res) => {
    const approvals = await taskStore.listApprovalTickets({
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      status: parseApprovalStatus(
        req.query.status ? String(req.query.status) : undefined,
      ),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.json({
      status: 'ok',
      approvals,
    });
  }));

  router.post('/actions/:agentId/:actionId/execute', withRouteSpan('agent-platform.actions.execute', async (req, res) => {
    const { agentId, actionId } = req.params;
    const payload = (req.body ?? {}) as AgentExecuteRequest;
    const traceId = req.header('x-trace-id') ?? undefined;
    const actorId = payload.context?.userRef;
    const tenantId = payload.context?.tenantId;

    await runWithSpan(
      'agent-platform.plan',
      async () => {
        await eventPublisher.publish({
          id: newEventId(),
          topic: AgentEventTopics.TaskStarted,
          timestamp: new Date().toISOString(),
          traceId,
          tenantId,
          actorId,
          source: 'agent-platform',
          payload: {
            agentId,
            actionId,
          },
        });
      },
      {
        attributes: {
          'smartops.phase': 'plan',
          'smartops.agent_id': agentId,
          'smartops.action_id': actionId,
          'smartops.trace_id': traceId,
        },
      },
    );

    const action = agentRegistry.getActionDefinition(agentId, actionId);

    const taskId = await runWithSpan(
      'agent-platform.plan.persist-task',
      async () => {
        const createdTaskId = await taskStore.createTask({
          tenantId,
          actorId,
          traceId,
          inputPrompt: `agent:${agentId}/${actionId}`,
          selectedAgentId: agentId,
          selectedActionId: actionId,
          riskLevel: action?.riskLevel,
          requestPayload: payload.input,
        });

        await taskStore.appendAudit({
          tenantId,
          taskId: createdTaskId ?? undefined,
          traceId,
          eventTopic: AgentEventTopics.TaskStarted,
          eventSource: 'agent-platform',
          payload: {
            agentId,
            actionId,
          },
        });

        return createdTaskId;
      },
      {
        attributes: {
          'smartops.phase': 'plan',
          'smartops.agent_id': agentId,
          'smartops.action_id': actionId,
          'smartops.trace_id': traceId,
        },
      },
    );

    if (!action) {
      res.status(404).json({
        status: 'error',
        error: `Action ${actionId} is not registered for agent ${agentId}`,
      });
      return;
    }

    if (action.riskLevel === 'high' && !payload.context?.approval?.approved) {
      await runWithSpan(
        'agent-platform.verify.approval-required',
        async () => {
          await eventPublisher.publish({
            id: newEventId(),
            topic: AgentEventTopics.TaskApprovalRequired,
            timestamp: new Date().toISOString(),
            traceId,
            tenantId,
            actorId,
            source: 'agent-platform',
            payload: {
              agentId,
              actionId,
              riskLevel: action.riskLevel,
              title: action.title,
            },
          });
        },
        {
          attributes: {
            'smartops.phase': 'verify',
            'smartops.agent_id': agentId,
            'smartops.action_id': actionId,
            'smartops.trace_id': traceId,
          },
        },
      );
      res.status(202).json({
        status: 'approval_required',
        approval: {
          required: true,
          riskLevel: action.riskLevel,
          reason: `Action ${action.title} is high risk and requires approval`,
        },
      });

      if (taskId && tenantId) {
        await runWithSpan(
          'agent-platform.verify.persist-approval',
          async () => {
            await taskStore.setTaskStatus({
              taskId,
              status: 'approval_required',
              responsePayload: {
                agentId,
                actionId,
                reason: `Action ${action.title} is high risk and requires approval`,
              },
            });

            await taskStore.createApprovalTicket({
              taskId,
              tenantId,
              agentId,
              actionId,
              riskLevel: action.riskLevel,
              reason: `Action ${action.title} is high risk and requires approval`,
            });

            await taskStore.appendAudit({
              tenantId,
              taskId,
              traceId,
              eventTopic: AgentEventTopics.TaskApprovalRequired,
              eventSource: 'agent-platform',
              payload: {
                agentId,
                actionId,
                riskLevel: action.riskLevel,
              },
            });
          },
          {
            attributes: {
              'smartops.phase': 'verify',
              'smartops.agent_id': agentId,
              'smartops.action_id': actionId,
              'smartops.trace_id': traceId,
              'smartops.task_id': taskId,
            },
          },
        );
      }

      return;
    }

    const result = await runWithSpan(
      'agent-platform.act.execute',
      async () => agentRegistry.execute(agentId, actionId, payload),
      {
        attributes: {
          'smartops.phase': 'act',
          'smartops.agent_id': agentId,
          'smartops.action_id': actionId,
          'smartops.trace_id': traceId,
          'smartops.task_id': taskId ?? undefined,
        },
      },
    );

    const backupRunId = taskId ? readBackupRunId(result) : undefined;
    if (taskId && backupRunId) {
      await taskStore.linkBackupRunToTask({
        backupRunId,
        taskId,
        traceId,
      });
    }

    if (result.status === 'error') {
      await runWithSpan(
        'agent-platform.verify.failed',
        async () => {
          await eventPublisher.publish({
            id: newEventId(),
            topic: AgentEventTopics.TaskRejected,
            timestamp: new Date().toISOString(),
            traceId,
            tenantId,
            actorId,
            source: 'agent-platform',
            payload: {
              agentId,
              actionId,
              error: result.error,
            },
          });
        },
        {
          attributes: {
            'smartops.phase': 'verify',
            'smartops.agent_id': agentId,
            'smartops.action_id': actionId,
            'smartops.trace_id': traceId,
            'smartops.task_id': taskId ?? undefined,
          },
        },
      );
      logger.warn(`Agent action failed ${agentId}/${actionId}: ${result.error}`);

      if (taskId) {
        await runWithSpan(
          'agent-platform.verify.persist-failed',
          async () => {
            await taskStore.setTaskStatus({
              taskId,
              status: 'failed',
              errorMessage: result.error,
              responsePayload: result,
            });
            await taskStore.appendAudit({
              tenantId,
              taskId,
              traceId,
              eventTopic: AgentEventTopics.TaskFailed,
              eventSource: 'agent-platform',
              payload: {
                agentId,
                actionId,
                error: result.error,
              },
            });
          },
          {
            attributes: {
              'smartops.phase': 'verify',
              'smartops.agent_id': agentId,
              'smartops.action_id': actionId,
              'smartops.trace_id': traceId,
              'smartops.task_id': taskId,
            },
          },
        );
      }

      res.status(400).json(result);
      return;
    }

    await runWithSpan(
      'agent-platform.verify.completed',
      async () => {
        await eventPublisher.publish({
          id: newEventId(),
          topic: AgentEventTopics.TaskCompleted,
          timestamp: new Date().toISOString(),
          traceId,
          tenantId,
          actorId,
          source: 'agent-platform',
          payload: {
            agentId,
            actionId,
          },
        });
      },
      {
        attributes: {
          'smartops.phase': 'verify',
          'smartops.agent_id': agentId,
          'smartops.action_id': actionId,
          'smartops.trace_id': traceId,
          'smartops.task_id': taskId ?? undefined,
        },
      },
    );

    if (taskId) {
      await runWithSpan(
        'agent-platform.verify.persist-completed',
        async () => {
          await taskStore.setTaskStatus({
            taskId,
            status: 'succeeded',
            responsePayload: result,
          });
          await taskStore.appendAudit({
            tenantId,
            taskId,
            traceId,
            eventTopic: AgentEventTopics.TaskCompleted,
            eventSource: 'agent-platform',
            payload: {
              agentId,
              actionId,
            },
          });
        },
        {
          attributes: {
            'smartops.phase': 'verify',
            'smartops.agent_id': agentId,
            'smartops.action_id': actionId,
            'smartops.trace_id': traceId,
            'smartops.task_id': taskId,
          },
        },
      );
    }

    res.json(result);
  }));

  router.post('/approvals/:ticketId/decision', withRouteSpan('agent-platform.approvals.decision', async (req, res) => {
    const { ticketId } = req.params;
    const parsedInput = approvalDecisionInputSchema.safeParse(req.body ?? {});
    if (!parsedInput.success) {
      res.status(400).json({
        status: 'error',
        error: 'Invalid approval decision payload',
      });
      return;
    }

    const context = await runWithSpan(
      'agent-platform.plan.load-approval-context',
      async () => taskStore.getApprovalExecutionContext(ticketId),
      {
        attributes: {
          'smartops.phase': 'plan',
          'smartops.ticket_id': ticketId,
        },
      },
    );

    if (!context) {
      res.status(404).json({
        status: 'error',
        error: `Approval ticket ${ticketId} not found`,
      });
      return;
    }

    if (context.ticketStatus !== 'pending') {
      const task = await taskStore.getTask(context.taskId);
      res.json({
        status: 'ok',
        decision: context.ticketStatus,
        resumedExecution: false,
        idempotent: true,
        task,
      });
      return;
    }

    if (
      context.taskStatus === 'succeeded' ||
      context.taskStatus === 'failed' ||
      context.taskStatus === 'rejected'
    ) {
      const task = await taskStore.getTask(context.taskId);
      res.json({
        status: 'ok',
        decision: parsedInput.data.decision,
        resumedExecution: false,
        idempotent: true,
        task,
      });
      return;
    }

    const decisionSaved = await runWithSpan(
      'agent-platform.verify.persist-decision',
      async () =>
        taskStore.decideApprovalTicket({
          ticketId,
          decision: parsedInput.data.decision,
          decidedBy: parsedInput.data.decidedBy,
          note: parsedInput.data.note,
        }),
      {
        attributes: {
          'smartops.phase': 'verify',
          'smartops.ticket_id': ticketId,
          'smartops.decision': parsedInput.data.decision,
          'smartops.task_id': context.taskId,
          'smartops.trace_id': context.traceId,
        },
      },
    );

    if (!decisionSaved) {
      res.status(500).json({
        status: 'error',
        error: 'Failed to persist approval decision',
      });
      return;
    }

    if (parsedInput.data.decision === 'approved') {
      await taskStore.setTaskStatus({
        taskId: context.taskId,
        status: 'approved',
      });
    }

    if (parsedInput.data.decision === 'rejected') {
      await runWithSpan(
        'agent-platform.verify.reject-task',
        async () => {
          await taskStore.setTaskStatus({
            taskId: context.taskId,
            status: 'rejected',
            errorMessage: parsedInput.data.note ?? 'Rejected by approver',
          });
          await eventPublisher.publish({
            id: newEventId(),
            topic: AgentEventTopics.TaskFailed,
            timestamp: new Date().toISOString(),
            traceId: context.traceId,
            tenantId: context.tenantId,
            actorId: parsedInput.data.decidedBy,
            source: 'agent-platform',
            payload: {
              ticketId,
              taskId: context.taskId,
              decision: 'rejected',
              note: parsedInput.data.note,
            },
          });
          await taskStore.appendAudit({
            tenantId: context.tenantId,
            taskId: context.taskId,
            traceId: context.traceId,
            eventTopic: AgentEventTopics.TaskRejected,
            eventSource: 'agent-platform',
            payload: {
              ticketId,
              decision: 'rejected',
              note: parsedInput.data.note,
            },
          });
        },
        {
          attributes: {
            'smartops.phase': 'verify',
            'smartops.ticket_id': ticketId,
            'smartops.task_id': context.taskId,
            'smartops.trace_id': context.traceId,
          },
        },
      );

      res.json({
        status: 'ok',
        decision: 'rejected',
        resumedExecution: false,
      });
      return;
    }

    const executionResult = await runWithSpan(
      'agent-platform.act.resume-execution',
      async () =>
        agentRegistry.execute(context.agentId, context.actionId, {
          input: context.requestPayload,
          context: {
            tenantId: context.tenantId,
            userRef: context.actorId,
            approval: {
              approved: true,
              ticketId,
              approver: parsedInput.data.decidedBy,
            },
          },
        }),
      {
        attributes: {
          'smartops.phase': 'act',
          'smartops.ticket_id': ticketId,
          'smartops.task_id': context.taskId,
          'smartops.trace_id': context.traceId,
          'smartops.agent_id': context.agentId,
          'smartops.action_id': context.actionId,
        },
      },
    );

    const resumedBackupRunId = readBackupRunId(executionResult);
    if (resumedBackupRunId) {
      await taskStore.linkBackupRunToTask({
        backupRunId: resumedBackupRunId,
        taskId: context.taskId,
        traceId: context.traceId,
      });
    }

    await runWithSpan(
      'agent-platform.verify.resume-result',
      async () => {
        if (executionResult.status === 'error') {
          await taskStore.setTaskStatus({
            taskId: context.taskId,
            status: 'failed',
            errorMessage: executionResult.error,
            responsePayload: executionResult,
          });

          await eventPublisher.publish({
            id: newEventId(),
            topic: AgentEventTopics.TaskFailed,
            timestamp: new Date().toISOString(),
            traceId: context.traceId,
            tenantId: context.tenantId,
            actorId: parsedInput.data.decidedBy,
            source: 'agent-platform',
            payload: {
              ticketId,
              taskId: context.taskId,
              decision: 'approved',
              resumedExecution: 'failed',
              error: executionResult.error,
            },
          });

          await taskStore.appendAudit({
            tenantId: context.tenantId,
            taskId: context.taskId,
            traceId: context.traceId,
            eventTopic: AgentEventTopics.TaskFailed,
            eventSource: 'agent-platform',
            payload: {
              ticketId,
              decision: 'approved',
              resumedExecution: 'failed',
              error: executionResult.error,
            },
          });

          return;
        }

        await taskStore.setTaskStatus({
          taskId: context.taskId,
          status: 'succeeded',
          responsePayload: executionResult,
        });

        await eventPublisher.publish({
          id: newEventId(),
          topic: AgentEventTopics.TaskApproved,
          timestamp: new Date().toISOString(),
          traceId: context.traceId,
          tenantId: context.tenantId,
          actorId: parsedInput.data.decidedBy,
          source: 'agent-platform',
          payload: {
            ticketId,
            taskId: context.taskId,
            decision: 'approved',
            resumedExecution: 'succeeded',
          },
        });

        await taskStore.appendAudit({
          tenantId: context.tenantId,
          taskId: context.taskId,
          traceId: context.traceId,
          eventTopic: AgentEventTopics.TaskApproved,
          eventSource: 'agent-platform',
          payload: {
            ticketId,
            decision: 'approved',
            resumedExecution: 'succeeded',
          },
        });
      },
      {
        attributes: {
          'smartops.phase': 'verify',
          'smartops.ticket_id': ticketId,
          'smartops.task_id': context.taskId,
          'smartops.trace_id': context.traceId,
        },
      },
    );

    if (executionResult.status === 'error') {
      res.status(400).json({
        status: 'error',
        decision: 'approved',
        resumedExecution: true,
        execution: executionResult,
      });
      return;
    }

    res.json({
      status: 'ok',
      decision: 'approved',
      resumedExecution: true,
      execution: executionResult,
    });
  }));

  return router;
};
