export type AgentRiskLevel = 'low' | 'medium' | 'high';

export type AgentUiExtension = {
  id: string;
  title: string;
  placement: 'settings';
  description?: string;
};

export type AgentActionDefinition = {
  id: string;
  title: string;
  description?: string;
  riskLevel: AgentRiskLevel;
  inputExample?: Record<string, unknown>;
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
    approval?: {
      approved?: boolean;
      ticketId?: string;
      approver?: string;
    };
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

export type AgentActionHandler = (
  request: AgentExecuteRequest,
) => Promise<AgentExecuteResult>;
