import { z } from 'zod';

export const eventEnvelopeSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  timestamp: z.string().min(1),
  traceId: z.string().optional(),
  tenantId: z.string().optional(),
  actorId: z.string().optional(),
  source: z.string().min(1),
  payload: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
