import { z } from 'zod';

import { agentRiskLevelSchema } from './actionContract';

export const approvalDecisionSchema = z.enum(['approved', 'rejected']);

export const approvalTicketSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  actionId: z.string().min(1),
  riskLevel: agentRiskLevelSchema,
  requestedBy: z.string().min(1),
  reason: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: z.string().min(1),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
});

export const approvalDecisionInputSchema = z.object({
  decision: approvalDecisionSchema,
  decidedBy: z.string().min(1),
  note: z.string().optional(),
});

export type ApprovalTicket = z.infer<typeof approvalTicketSchema>;
