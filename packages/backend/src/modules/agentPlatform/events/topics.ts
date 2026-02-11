export const AgentEventTopics = {
  TaskPlanned: 'task.planned',
  TaskStarted: 'task.started',
  TaskApprovalRequired: 'task.approval.required',
  TaskApproved: 'task.approved',
  TaskRejected: 'task.rejected',
  TaskCompleted: 'task.completed',
  TaskFailed: 'task.failed',
  AuditAppended: 'audit.appended',
} as const;

export type AgentEventTopic =
  (typeof AgentEventTopics)[keyof typeof AgentEventTopics];
