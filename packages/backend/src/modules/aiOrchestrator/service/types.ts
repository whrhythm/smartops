export type AiMessageEvent = {
  channel: 'wecom';
  channelUserId: string;
  phone?: string;
  text: string;
  timestamp?: string;
};

export type AiUserContext = {
  phone: string;
  tenantId: string;
  userRef: string;
  wecomUserId?: string;
};

export type AiActionPlan = {
  domain: 'k8s' | 'vm' | 'unknown';
  requiresApproval: boolean;
  reason: string;
};
