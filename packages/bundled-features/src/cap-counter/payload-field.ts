import { isPlainObject } from "@cosmicdrift/kumiko-framework/utils";

// Create payloads are flat, entity update payloads carry the edited fields under `changes`
// (`{ id, version, changes }`), so a guard that follows one field has to look at both.
export function readPayloadField(payload: unknown, field: string): unknown {
  if (!isPlainObject(payload)) return undefined;
  if (field in payload) return payload[field];
  const { changes } = payload;
  return isPlainObject(changes) ? changes[field] : undefined;
}
