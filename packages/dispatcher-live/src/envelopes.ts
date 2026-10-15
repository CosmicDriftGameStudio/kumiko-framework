import * as z from "zod";

// Wire envelopes of /api/{write,query,batch,stream}. Only the envelope is
// validated; `data` payloads stay unknown and are typed by the caller.

export const serverErrorSchema = z.object({
  code: z.string(),
  httpStatus: z.number().optional(),
  i18nKey: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  i18nParams: z.record(z.string(), z.unknown()).optional(),
  docsUrl: z.string().optional(),
  requestId: z.string().optional(),
});

export type ServerErrorLike = z.infer<typeof serverErrorSchema>;

const writeItemSchema = z.discriminatedUnion("isSuccess", [
  z.object({ isSuccess: z.literal(true), data: z.unknown().optional() }),
  z.object({ isSuccess: z.literal(false), error: serverErrorSchema }),
]);

export const writeEnvelopeSchema = writeItemSchema;

export const batchEnvelopeSchema = z.discriminatedUnion("isSuccess", [
  z.object({ isSuccess: z.literal(true), results: z.array(writeItemSchema) }),
  z.object({
    isSuccess: z.literal(false),
    error: serverErrorSchema,
    failedIndex: z.number(),
    results: z.array(writeItemSchema),
  }),
]);

// `error` is nullish: a null/absent error means success, as before.
export const queryEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  error: serverErrorSchema.nullish(),
});

export const errorOnlyEnvelopeSchema = z.object({ error: serverErrorSchema });
