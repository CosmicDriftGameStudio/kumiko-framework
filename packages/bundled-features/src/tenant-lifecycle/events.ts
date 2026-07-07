import { z } from "zod";

export const destructionRequestedSchema = z.object({
  requestedBy: z.uuid(),
  gracePeriodEnd: z.string().datetime(),
});

export const destructionCancelledSchema = z.object({
  cancelledBy: z.uuid(),
});

export const tenantDestructionStartedSchema = z.object({
  startedAt: z.string().datetime(),
});

export const tenantDestructionStageStartedSchema = z.object({
  stage: z.string().min(1),
  attempts: z.number().int().positive(),
});

export const tenantDestructionStageSucceededSchema = z.object({
  stage: z.string().min(1),
  attempts: z.number().int().positive(),
});

export const tenantDestructionStageFailedSchema = z.object({
  stage: z.string().min(1),
  attempts: z.number().int().positive(),
  error: z.string().min(1),
});

export const tenantDestructionStageAbandonedSchema = z.object({
  stage: z.string().min(1),
  attempts: z.number().int().positive(),
  error: z.string().min(1),
});

export const tenantDestructionCompletedSchema = z.object({
  destroyedAt: z.string().datetime(),
});

export const tenantDestructionFailedSchema = z.object({
  stage: z.string().min(1),
  error: z.string().min(1),
  failedAt: z.string().datetime(),
});
