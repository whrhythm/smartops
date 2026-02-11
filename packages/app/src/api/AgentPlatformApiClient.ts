import {
  createApiRef,
  DiscoveryApi,
  IdentityApi,
} from '@backstage/core-plugin-api';

export type AgentRiskLevel = 'low' | 'medium' | 'high';

export type AgentActionDefinition = {
  id: string;
  title: string;
  description?: string;
  riskLevel: AgentRiskLevel;
  inputExample?: Record<string, unknown>;
};

export type AgentUiExtension = {
  id: string;
  title: string;
  placement: 'settings';
  description?: string;
};

export type AgentDefinition = {
  id: string;
  name: string;
  description?: string;
  version: string;
  actions: AgentActionDefinition[];
  uiExtensions?: AgentUiExtension[];
};

export type AgentExecuteRequest = {
  input?: Record<string, unknown>;
  context?: {
    tenantId?: string;
    userRef?: string;
  };
};

export type AgentExecuteResult = {
  status: 'ok' | 'error' | 'approval_required';
  output?: unknown;
  error?: string;
  approval?: {
    required: boolean;
    riskLevel: AgentRiskLevel;
    reason: string;
  };
};

export type TaskStatus =
  | 'planned'
  | 'running'
  | 'approval_required'
  | 'approved'
  | 'rejected'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

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

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type ApprovalTicketSnapshot = {
  id: string;
  taskId: string;
  tenantId: string;
  agentId: string;
  actionId: string;
  riskLevel: AgentRiskLevel;
  reason: string;
  status: ApprovalStatus;
  decisionNote?: string;
  decidedAt?: string;
  decidedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalDecisionResult = {
  status: 'ok' | 'error';
  decision: string;
  resumedExecution: boolean;
  idempotent?: boolean;
  task?: TaskSnapshot | null;
  execution?: unknown;
};

export interface AgentPlatformApi {
  listAgents(): Promise<AgentDefinition[]>;
  listTasks(options?: {
    tenantId?: string;
    status?: TaskStatus;
    limit?: number;
  }): Promise<TaskSnapshot[]>;
  getTask(taskId: string): Promise<TaskSnapshot>;
  listApprovals(options?: {
    tenantId?: string;
    status?: ApprovalStatus;
    limit?: number;
  }): Promise<ApprovalTicketSnapshot[]>;
  getApproval(ticketId: string): Promise<ApprovalTicketSnapshot>;
  decideApproval(
    ticketId: string,
    input: {
      decision: 'approved' | 'rejected';
      decidedBy: string;
      note?: string;
    },
  ): Promise<ApprovalDecisionResult>;
  executeAction(
    agentId: string,
    actionId: string,
    payload: AgentExecuteRequest,
  ): Promise<AgentExecuteResult>;
}

export const agentPlatformApiRef = createApiRef<AgentPlatformApi>({
  id: 'app.smartops.agent-platform.service',
});

type Options = {
  discoveryApi: DiscoveryApi;
  identityApi: IdentityApi;
};

export class AgentPlatformApiClient implements AgentPlatformApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly identityApi: IdentityApi;

  constructor(options: Options) {
    this.discoveryApi = options.discoveryApi;
    this.identityApi = options.identityApi;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const { token } = await this.identityApi.getCredentials();
    const baseUrl = await this.discoveryApi.getBaseUrl('agent-platform');
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Agent platform error (${response.status}): ${await response.text()}`,
      );
    }

    return (await response.json()) as T;
  }

  async listAgents(): Promise<AgentDefinition[]> {
    const response = await this.request<{ agents: AgentDefinition[] }>('/agents');
    return response.agents;
  }

  async listTasks(options?: {
    tenantId?: string;
    status?: TaskStatus;
    limit?: number;
  }): Promise<TaskSnapshot[]> {
    const query = new URLSearchParams();
    if (options?.tenantId) {
      query.set('tenantId', options.tenantId);
    }
    if (options?.status) {
      query.set('status', options.status);
    }
    if (options?.limit !== undefined) {
      query.set('limit', String(options.limit));
    }
    const path = query.toString() ? `/tasks?${query.toString()}` : '/tasks';
    const response = await this.request<{ tasks: TaskSnapshot[] }>(path);
    return response.tasks;
  }

  async getTask(taskId: string): Promise<TaskSnapshot> {
    const response = await this.request<{ task: TaskSnapshot }>(
      `/tasks/${encodeURIComponent(taskId)}`,
    );
    return response.task;
  }

  async listApprovals(options?: {
    tenantId?: string;
    status?: ApprovalStatus;
    limit?: number;
  }): Promise<ApprovalTicketSnapshot[]> {
    const query = new URLSearchParams();
    if (options?.tenantId) {
      query.set('tenantId', options.tenantId);
    }
    if (options?.status) {
      query.set('status', options.status);
    }
    if (options?.limit !== undefined) {
      query.set('limit', String(options.limit));
    }
    const path = query.toString() ? `/approvals?${query.toString()}` : '/approvals';
    const response = await this.request<{ approvals: ApprovalTicketSnapshot[] }>(
      path,
    );
    return response.approvals;
  }

  async getApproval(ticketId: string): Promise<ApprovalTicketSnapshot> {
    const response = await this.request<{ approval: ApprovalTicketSnapshot }>(
      `/approvals/${encodeURIComponent(ticketId)}`,
    );
    return response.approval;
  }

  async decideApproval(
    ticketId: string,
    input: {
      decision: 'approved' | 'rejected';
      decidedBy: string;
      note?: string;
    },
  ): Promise<ApprovalDecisionResult> {
    return this.request<ApprovalDecisionResult>(
      `/approvals/${encodeURIComponent(ticketId)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  async executeAction(
    agentId: string,
    actionId: string,
    payload: AgentExecuteRequest,
  ): Promise<AgentExecuteResult> {
    return this.request<AgentExecuteResult>(
      `/actions/${encodeURIComponent(agentId)}/${encodeURIComponent(actionId)}/execute`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }
}
