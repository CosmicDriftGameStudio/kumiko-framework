// @runtime client
// URL-Bridge für Visual-Tree-Targets. Serialisiert TargetRef in
// Search-Params + parsed zurück.
//
// **URL-Shape**:
//   ?t=<featureId>:<action>&a_<argKey1>=<value1>&a_<argKey2>=<value2>...
//
// Beispiel: text-content edit "imprint/de"
//   ?t=text-content:edit&a_slug=imprint&a_lang=de
//
// **Warum prefix `a_`**: vermeidet Naming-Konflikt mit anderen Query-
// Params (Pagination, Sort, Filter). Plus klare Trennung target-meta
// (`t`) vs. action-args (`a_*`).
//
// **Warum nicht JSON-encoded**: URL bleibt lesbar + bookmark-fähig.
// JSON-base64 wäre robust für arbitrary Shapes aber unleserlich. arg-
// values sind heute nur primitive strings (text-content: slug, lang) —
// V.1.5 kann auf JSON wechseln wenn nested-args echten Bedarf zeigen.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";

const TARGET_PARAM = "t";
const ARG_PREFIX = "a_";

/** Build a search-params update for `setSearchParams`. Clears all
 *  existing `a_*` keys plus `t` (so wechsel target nicht alte args
 *  liegen lässt). Returns null-value entries to clear, plus the new
 *  target entries. */
export function serializeTarget(
  target: TargetRef,
  currentParams: Readonly<Record<string, string>>,
): Readonly<Record<string, string | null>> {
  const updates: Record<string, string | null> = {};
  // Clear all previous arg-keys (vermeidet stale args bei target-switch).
  for (const key of Object.keys(currentParams)) {
    if (key.startsWith(ARG_PREFIX)) updates[key] = null;
  }
  updates[TARGET_PARAM] = `${target.featureId}:${target.action}`;
  if (target.args !== undefined) {
    for (const [k, v] of Object.entries(target.args)) {
      // V.1.4b: nur string-args. Numbers/booleans werden via String()
      // koerziert; nested objects/arrays werden NICHT supported (würde
      // JSON-encoded URL brauchen, siehe Header-Comment).
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        updates[`${ARG_PREFIX}${k}`] = String(v);
      }
    }
  }
  return updates;
}

/** Inverse — parse the current search-params back into a TargetRef.
 *  Returns undefined wenn der `t`-Key fehlt (kein active target). */
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

/** Returns null-valued updates that clear target + all args. Used vom
 *  Close-Button + onUnmount. */
export function clearTargetSearchParams(
  currentParams: Readonly<Record<string, string>>,
): Readonly<Record<string, string | null>> {
  const updates: Record<string, string | null> = { [TARGET_PARAM]: null };
  for (const key of Object.keys(currentParams)) {
    if (key.startsWith(ARG_PREFIX)) updates[key] = null;
  }
  return updates;
}
