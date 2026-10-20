import { requestContext } from "../api/request-context.ts";

// Only set fields are emitted so log lines outside a request stay lean.
export function requestLogFields(): Record<string, string> {
  const store = requestContext.get();
  if (!store) return {};
  const fields: Record<string, string> = {};
  if (store.requestId) fields["requestId"] = store.requestId;
  if (store.correlationId) fields["correlationId"] = store.correlationId;
  if (store.tenantId) fields["tenantId"] = store.tenantId;
  if (store.userId) fields["userId"] = store.userId;
  if (store.feature) fields["feature"] = store.feature;
  if (store.handler) fields["handler"] = store.handler;
  return fields;
}
