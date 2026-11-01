import * as z from "zod";

// One recorded HTTP exchange, shared by the recorder (testing) and the API docs generator (bundled-features).
export const apiExampleEndpoints = ["/api/query", "/api/write", "/api/batch"] as const;

export type ApiExampleEndpoint = (typeof apiExampleEndpoints)[number];

export const ApiExampleFileSchema = z.object({
  request: z.object({
    endpoint: z.enum(apiExampleEndpoints),
    body: z.object({
      type: z.string().optional(),
      payload: z.unknown().optional(),
      commands: z.array(z.object({ type: z.string(), payload: z.unknown().optional() })).optional(),
      requestId: z.string().optional(),
    }),
  }),
  response: z.object({
    status: z.number().int(),
    body: z.unknown(),
  }),
});

export type ApiExampleFile = z.infer<typeof ApiExampleFileSchema>;
