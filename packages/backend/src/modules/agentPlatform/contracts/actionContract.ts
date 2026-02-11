import { z } from 'zod';

export const agentRiskLevelSchema = z.enum(['low', 'medium', 'high']);

export const agentActionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  riskLevel: agentRiskLevelSchema,
  inputExample: z.record(z.unknown()).optional(),
});

export const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1),
  actions: z.array(agentActionSchema).min(1),
  uiExtensions: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        placement: z.literal('settings'),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export const agentExecuteRequestSchema = z.object({
  input: z.record(z.unknown()).optional(),
  context: z
    .object({
      tenantId: z.string().optional(),
      userRef: z.string().optional(),
      approval: z
        .object({
          approved: z.boolean().optional(),
          ticketId: z.string().optional(),
          approver: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type AgentActionContract = z.infer<typeof agentActionSchema>;
export type AgentDefinitionContract = z.infer<typeof agentDefinitionSchema>;
export type AgentExecuteRequestContract = z.infer<
  typeof agentExecuteRequestSchema
>;
