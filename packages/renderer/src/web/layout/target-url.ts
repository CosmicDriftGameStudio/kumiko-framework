// @runtime client
// URL bridge for visual-tree targets. Serializes TargetRef into
// search params and parses it back.
//
// **URL shape**:
//   ?t=<featureId>:<action>&a_<argKey1>=<value1>&a_<argKey2>=<value2>...
//
// Example: text-content edit "imprint/de"
//   ?t=text-content:edit&a_slug=imprint&a_lang=de
//
// **Why the `a_` prefix**: avoids naming conflicts with other query
// params (pagination, sorting, filtering) and clearly separates target
// metadata (`t`) from action arguments (`a_*`).
//
// **Why not JSON-encoded**: keeps the URL readable and bookmarkable.
// JSON-base64 would be robust for arbitrary shapes but unreadable. Argument
// values are currently only primitive strings (text-content: slug, lang) —
// nested arguments could switch to JSON if they create a real need.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";

const TARGET_PARAM = "t";
const ARG_PREFIX = "a_";

/** Builds a search-params update for `setSearchParams`. Clears all
 *  existing `a_*` keys plus `t` so switching targets cannot leave stale
 *  arguments behind. Returns null-valued entries to clear, plus the new
 *  target entries. */
export function serializeTarget(
  target: TargetRef,
  currentParams: Readonly<Record<string, string>>,
): Readonly<Record<string, string | null>> {
  const updates: Record<string, string | null> = {};
  // Clear previous argument keys so switching targets cannot leave stale arguments.
  for (const key of Object.keys(currentParams)) {
    if (key.startsWith(ARG_PREFIX)) updates[key] = null;
  }
  updates[TARGET_PARAM] = `${target.featureId}:${target.action}`;
  if (target.args !== undefined) {
    for (const [k, v] of Object.entries(target.args)) {
      // Only string arguments are supported. Numbers and booleans are coerced via String();
      // nested objects and arrays are unsupported because they would require a
      // JSON-encoded URL.
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        updates[`${ARG_PREFIX}${k}`] = String(v);
      }
    }
  }
  return updates;
}

/** Parses the current search parameters back into a TargetRef.
 *  Returns undefined when the `t` key is missing, indicating no active target. */
export function parseTargetFromSearchParams(
  params: Readonly<Record<string, string>>,
): TargetRef | undefined {
  const t = params[TARGET_PARAM];
  if (t === undefined || t === "") return undefined;
  const sepIdx = t.indexOf(":");
  if (sepIdx < 0) return undefined;
  const featureId = t.slice(0, sepIdx);
  const action = t.slice(sepIdx + 1);
  if (featureId === "" || action === "") return undefined;

  const args: Record<string, string> = {};
  let hasArgs = false;
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith(ARG_PREFIX)) {
      args[key.slice(ARG_PREFIX.length)] = value;
      hasArgs = true;
    }
  }
  return hasArgs ? { featureId, action, args } : { featureId, action };
}

/** Returns null-valued updates that clear the target and all arguments. Used by
 *  the close button and on unmount. */
export function clearTargetSearchParams(
  currentParams: Readonly<Record<string, string>>,
): Readonly<Record<string, string | null>> {
  const updates: Record<string, string | null> = { [TARGET_PARAM]: null };
  for (const key of Object.keys(currentParams)) {
    if (key.startsWith(ARG_PREFIX)) updates[key] = null;
  }
  return updates;
}
