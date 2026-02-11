import { DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';

type TaskStatus =
  | 'planned'
  | 'running'
  | 'approval_required'
  | 'approved'
  | 'rejected'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type CreateTaskInput = {
  tenantId?: string;
  actorId?: string;
  traceId?: string;
  inputPrompt: string;
  selectedAgentId?: string;
  selectedActionId?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  requestPayload?: Record<string, unknown>;
};

type ApprovalTicketInput = {
  taskId: string;
  tenantId: string;
  agentId: string;
  actionId: string;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
};

type ApprovalTicketDecision = {
  ticketId: string;
  decision: 'approved' | 'rejected';
  decidedBy?: string;
  note?: string;
};

export type ApprovalExecutionContext = {
  ticketId: string;
  ticketStatus: 'pending' | 'approved' | 'rejected' | 'expired';
  taskId: string;
  taskStatus:
    | 'planned'
    | 'running'
    | 'approval_required'
    | 'approved'
    | 'rejected'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  tenantId: string;
  actorId?: string;
  traceId?: string;
  agentId: string;
  actionId: string;
  requestPayload: Record<string, unknown>;
};

export type TaskSnapshot = {
  id: string;
  tenantId: string;
  traceId?: string;
  status: TaskStatus;
  selectedAgentId?: string;
  selectedActionId?: string;
  inputPrompt: string;
  requestPayload: Record<string, unknown>;
  responsePayload?: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalTicketSnapshot = {
  id: string;
  taskId: string;
  tenantId: string;
  agentId: string;
  actionId: string;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decisionNote?: string;
  decidedAt?: string;
  decidedBy?: string;
  createdAt: string;
  updatedAt: string;
};

type ListTasksOptions = {
  tenantId?: string;
  status?: TaskStatus;
  limit?: number;
};

type ListApprovalsOptions = {
  tenantId?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
  limit?: number;
};

export interface TaskStore {
  createTask(input: CreateTaskInput): Promise<string | null>;
  setTaskStatus(options: {
    taskId: string;
    status: TaskStatus;
    responsePayload?: unknown;
    errorMessage?: string;
  }): Promise<void>;
  createApprovalTicket(input: ApprovalTicketInput): Promise<string | null>;
  listTasks(options?: ListTasksOptions): Promise<TaskSnapshot[]>;
  listApprovalTickets(options?: ListApprovalsOptions): Promise<ApprovalTicketSnapshot[]>;
  getTask(taskId: string): Promise<TaskSnapshot | null>;
  getApprovalTicket(ticketId: string): Promise<ApprovalTicketSnapshot | null>;
  getApprovalExecutionContext(
    ticketId: string,
  ): Promise<ApprovalExecutionContext | null>;
  decideApprovalTicket(input: ApprovalTicketDecision): Promise<boolean>;
  appendAudit(options: {
    tenantId?: string;
    taskId?: string;
    traceId?: string;
    eventTopic: string;
    eventSource: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  linkBackupRunToTask(options: {
    backupRunId: string;
    taskId: string;
    traceId?: string;
  }): Promise<void>;
}

class NoopTaskStore implements TaskStore {
  async createTask(): Promise<string | null> {
    return null;
  }

  async setTaskStatus(): Promise<void> {}

  async createApprovalTicket(): Promise<string | null> {
    return null;
  }

  async listTasks(): Promise<TaskSnapshot[]> {
    return [];
  }

  async listApprovalTickets(): Promise<ApprovalTicketSnapshot[]> {
    return [];
  }

  async getTask(): Promise<TaskSnapshot | null> {
    return null;
  }

  async getApprovalTicket(): Promise<ApprovalTicketSnapshot | null> {
    return null;
  }

  async getApprovalExecutionContext(): Promise<ApprovalExecutionContext | null> {
    return null;
  }

  async decideApprovalTicket(): Promise<boolean> {
    return false;
  }

  async appendAudit(): Promise<void> {}

  async linkBackupRunToTask(): Promise<void> {}
}

class PostgresTaskStore implements TaskStore {
  constructor(private readonly db: Knex, private readonly logger: LoggerService) {}

  private isUuid(value?: string): value is string {
    if (!value) {
      return false;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  async createTask(input: CreateTaskInput): Promise<string | null> {
    if (!input.tenantId) {
      return null;
    }

    try {
      const [row] = await this.db('smartops.agent_tasks')
        .insert({
          tenant_id: input.tenantId,
          actor_id: this.isUuid(input.actorId) ? input.actorId : null,
          trace_id: input.traceId ?? null,
          input_prompt: input.inputPrompt,
          status: 'running',
          selected_agent_id: input.selectedAgentId ?? null,
          selected_action_id: input.selectedActionId ?? null,
          risk_level: input.riskLevel ?? null,
          request_payload: JSON.stringify(input.requestPayload ?? {}),
        })
        .returning(['id']);

      return row?.id ?? null;
    } catch (error) {
      this.logger.warn(`Task persistence failed: ${(error as Error).message}`);
      return null;
    }
  }

  async setTaskStatus(options: {
    taskId: string;
    status: TaskStatus;
    responsePayload?: unknown;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.db('smartops.agent_tasks')
        .where({ id: options.taskId })
        .update({
          status: options.status,
          response_payload:
            options.responsePayload === undefined
              ? null
              : JSON.stringify(options.responsePayload),
          error_message: options.errorMessage ?? null,
          updated_at: this.db.fn.now(),
        });
    } catch (error) {
      this.logger.warn(`Task status update failed: ${(error as Error).message}`);
    }
  }

  async createApprovalTicket(input: ApprovalTicketInput): Promise<string | null> {
    try {
      const [row] = await this.db('smartops.approval_tickets')
        .insert({
          task_id: input.taskId,
          tenant_id: input.tenantId,
          agent_id: input.agentId,
          action_id: input.actionId,
          risk_level: input.riskLevel,
          reason: input.reason,
          status: 'pending',
        })
        .returning(['id']);

      return row?.id ?? null;
    } catch (error) {
      this.logger.warn(`Approval ticket persistence failed: ${(error as Error).message}`);
      return null;
    }
  }

  async listTasks(options?: ListTasksOptions): Promise<TaskSnapshot[]> {
    try {
      const limit = Math.max(1, Math.min(100, options?.limit ?? 20));
      const query = this.db('smartops.agent_tasks')
        .select([
          'id',
          'tenant_id',
          'trace_id',
          'status',
          'selected_agent_id',
          'selected_action_id',
          'input_prompt',
          'request_payload',
          'response_payload',
          'error_message',
          'created_at',
          'updated_at',
        ])
        .orderBy('created_at', 'desc')
        .limit(limit);

      if (options?.tenantId) {
        query.where('tenant_id', options.tenantId);
      }
      if (options?.status) {
        query.where('status', options.status);
      }

      const rows = await query;
      return rows.map(row => {
        const requestPayloadRaw = row.request_payload;
        const responsePayloadRaw = row.response_payload;
        const requestPayload =
          typeof requestPayloadRaw === 'string'
            ? (JSON.parse(requestPayloadRaw) as Record<string, unknown>)
            : ((requestPayloadRaw as Record<string, unknown> | null) ?? {});
        const responsePayload =
          typeof responsePayloadRaw === 'string'
            ? (JSON.parse(responsePayloadRaw) as unknown)
            : (responsePayloadRaw as unknown);

        return {
          id: String(row.id),
          tenantId: String(row.tenant_id),
          traceId: row.trace_id ? String(row.trace_id) : undefined,
          status: row.status,
          selectedAgentId: row.selected_agent_id
            ? String(row.selected_agent_id)
            : undefined,
          selectedActionId: row.selected_action_id
            ? String(row.selected_action_id)
            : undefined,
          inputPrompt: String(row.input_prompt),
          requestPayload,
          responsePayload: responsePayload ?? undefined,
          errorMessage: row.error_message ? String(row.error_message) : undefined,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        } as TaskSnapshot;
      });
    } catch (error) {
      this.logger.warn(`Tasks list query failed: ${(error as Error).message}`);
      return [];
    }
  }

  async listApprovalTickets(
    options?: ListApprovalsOptions,
  ): Promise<ApprovalTicketSnapshot[]> {
    try {
      const limit = Math.max(1, Math.min(100, options?.limit ?? 20));
      const query = this.db('smartops.approval_tickets')
        .select([
          'id',
          'task_id',
          'tenant_id',
          'agent_id',
          'action_id',
          'risk_level',
          'reason',
          'status',
          'decision_note',
          'decided_at',
          'decided_by',
          'created_at',
          'updated_at',
        ])
        .orderBy('created_at', 'desc')
        .limit(limit);

      if (options?.tenantId) {
        query.where('tenant_id', options.tenantId);
      }
      if (options?.status) {
        query.where('status', options.status);
      }

      const rows = await query;
      return rows.map(row => ({
        id: String(row.id),
        taskId: String(row.task_id),
        tenantId: String(row.tenant_id),
        agentId: String(row.agent_id),
        actionId: String(row.action_id),
        riskLevel: row.risk_level,
        reason: String(row.reason),
        status: row.status,
        decisionNote: row.decision_note ? String(row.decision_note) : undefined,
        decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : undefined,
        decidedBy: row.decided_by ? String(row.decided_by) : undefined,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    } catch (error) {
      this.logger.warn(`Approvals list query failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getTask(taskId: string): Promise<TaskSnapshot | null> {
    try {
      const row = await this.db('smartops.agent_tasks')
        .select([
          'id',
          'tenant_id',
          'trace_id',
          'status',
          'selected_agent_id',
          'selected_action_id',
          'input_prompt',
          'request_payload',
          'response_payload',
          'error_message',
          'created_at',
          'updated_at',
        ])
        .where({ id: taskId })
        .first();

      if (!row) {
        return null;
      }

      const requestPayloadRaw = row.request_payload;
      const responsePayloadRaw = row.response_payload;

      const requestPayload =
        typeof requestPayloadRaw === 'string'
          ? (JSON.parse(requestPayloadRaw) as Record<string, unknown>)
          : ((requestPayloadRaw as Record<string, unknown> | null) ?? {});
      const responsePayload =
        typeof responsePayloadRaw === 'string'
          ? (JSON.parse(responsePayloadRaw) as unknown)
          : (responsePayloadRaw as unknown);

      return {
        id: String(row.id),
        tenantId: String(row.tenant_id),
        traceId: row.trace_id ? String(row.trace_id) : undefined,
        status: row.status,
        selectedAgentId: row.selected_agent_id
          ? String(row.selected_agent_id)
          : undefined,
        selectedActionId: row.selected_action_id
          ? String(row.selected_action_id)
          : undefined,
        inputPrompt: String(row.input_prompt),
        requestPayload,
        responsePayload: responsePayload ?? undefined,
        errorMessage: row.error_message ? String(row.error_message) : undefined,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    } catch (error) {
      this.logger.warn(`Task query failed: ${(error as Error).message}`);
      return null;
    }
  }

  async getApprovalTicket(ticketId: string): Promise<ApprovalTicketSnapshot | null> {
    try {
      const row = await this.db('smartops.approval_tickets')
        .select([
          'id',
          'task_id',
          'tenant_id',
          'agent_id',
          'action_id',
          'risk_level',
          'reason',
          'status',
          'decision_note',
          'decided_at',
          'decided_by',
          'created_at',
          'updated_at',
        ])
        .where({ id: ticketId })
        .first();

      if (!row) {
        return null;
      }

      return {
        id: String(row.id),
        taskId: String(row.task_id),
        tenantId: String(row.tenant_id),
        agentId: String(row.agent_id),
        actionId: String(row.action_id),
        riskLevel: row.risk_level,
        reason: String(row.reason),
        status: row.status,
        decisionNote: row.decision_note ? String(row.decision_note) : undefined,
        decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : undefined,
        decidedBy: row.decided_by ? String(row.decided_by) : undefined,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    } catch (error) {
      this.logger.warn(`Approval ticket query failed: ${(error as Error).message}`);
      return null;
    }
  }

  async getApprovalExecutionContext(
    ticketId: string,
  ): Promise<ApprovalExecutionContext | null> {
    try {
      const row = await this.db('smartops.approval_tickets as t')
        .leftJoin('smartops.agent_tasks as task', 'task.id', 't.task_id')
        .select([
          't.id as ticket_id',
          't.status as ticket_status',
          't.task_id as task_id',
          't.tenant_id as tenant_id',
          't.agent_id as agent_id',
          't.action_id as action_id',
          'task.actor_id as actor_id',
          'task.trace_id as trace_id',
          'task.status as task_status',
          'task.request_payload as request_payload',
        ])
        .where('t.id', ticketId)
        .first();

      if (!row) {
        return null;
      }

      const requestPayloadRaw = row.request_payload;
      const requestPayload =
        typeof requestPayloadRaw === 'string'
          ? (JSON.parse(requestPayloadRaw) as Record<string, unknown>)
          : ((requestPayloadRaw as Record<string, unknown> | null) ?? {});

      return {
        ticketId: String(row.ticket_id),
        ticketStatus: row.ticket_status,
        taskId: String(row.task_id),
        taskStatus: row.task_status,
        tenantId: String(row.tenant_id),
        actorId: row.actor_id ? String(row.actor_id) : undefined,
        traceId: row.trace_id ? String(row.trace_id) : undefined,
        agentId: String(row.agent_id),
        actionId: String(row.action_id),
        requestPayload,
      };
    } catch (error) {
      this.logger.warn(
        `Approval context query failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async decideApprovalTicket(input: ApprovalTicketDecision): Promise<boolean> {
    try {
      const nextStatus = input.decision === 'approved' ? 'approved' : 'rejected';
      const count = await this.db('smartops.approval_tickets')
        .where({ id: input.ticketId, status: 'pending' })
        .update({
          status: nextStatus,
          decision_note: input.note ?? null,
          decided_by: this.isUuid(input.decidedBy) ? input.decidedBy : null,
          decided_at: this.db.fn.now(),
          updated_at: this.db.fn.now(),
        });

      return Number(count) > 0;
    } catch (error) {
      this.logger.warn(`Approval decision update failed: ${(error as Error).message}`);
      return false;
    }
  }

  async appendAudit(options: {
    tenantId?: string;
    taskId?: string;
    traceId?: string;
    eventTopic: string;
    eventSource: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    if (!options.tenantId) {
      return;
    }

    try {
      await this.db('smartops.audit_logs').insert({
        tenant_id: options.tenantId,
        task_id: options.taskId ?? null,
        trace_id: options.traceId ?? null,
        event_topic: options.eventTopic,
        event_source: options.eventSource,
        payload: JSON.stringify(options.payload ?? {}),
      });
    } catch (error) {
      this.logger.warn(`Audit log persistence failed: ${(error as Error).message}`);
    }
  }

  async linkBackupRunToTask(options: {
    backupRunId: string;
    taskId: string;
    traceId?: string;
  }): Promise<void> {
    try {
      await this.db('smartops.backup_runs')
        .where({ id: options.backupRunId })
        .update({
          task_id: options.taskId,
          trace_id: options.traceId ?? null,
        });
    } catch (error) {
      this.logger.warn(`Backup run link update failed: ${(error as Error).message}`);
    }
  }
}

export const createTaskStore = async (
  database: DatabaseService,
  logger: LoggerService,
): Promise<TaskStore> => {
  try {
    const client = (await database.getClient()) as unknown as Knex;
    return new PostgresTaskStore(client, logger);
  } catch (error) {
    logger.warn(
      `Database client unavailable for task store, using noop: ${(error as Error).message}`,
    );
    return new NoopTaskStore();
  }
};
