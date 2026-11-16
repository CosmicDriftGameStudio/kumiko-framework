// Response-leak guard. Walks a handler-result tree and throws the moment it
// finds a Secret<> branded value — the dispatcher calls this after every
// handler returns, so accidentally including a plaintext secret in the
// response body becomes a runtime error at the handler boundary rather
// than a silent exfiltration to the client.

import { InternalError } from "../errors/index.ts";
import { isSecret } from "./types.ts";

// Maximum depth the walker descends. A legitimate result tree is rarely
// deeper than a few levels; the cap is a safety net against cyclic or
// pathologically-deep user input smuggled into a response.
const MAX_DEPTH = 12;

type LeakPathSegment =
  | string
  | number
  | { readonly mapEntry: number; readonly part: "key" | "val" }
  | { readonly setEntry: number };

// Built only on a hit: the walker runs on every handler result, so eager path
// strings would allocate one per node.
function formatLeakPath(segments: readonly LeakPathSegment[]): string {
  let path = "$";
  for (const segment of segments) {
    if (typeof segment === "number") path += `[${segment}]`;
    else if (typeof segment === "string") path += `.${segment}`;
    else if ("mapEntry" in segment) path += `.<map[${segment.mapEntry}].${segment.part}>`;
    else path += `.<set[${segment.setEntry}]>`;
  }
  return path;
}

export function assertNoSecretLeak(value: unknown): void {
  walkForSecrets(value, [], 0);
}

function walkChild(
  child: unknown,
  segment: LeakPathSegment,
  segments: LeakPathSegment[],
  depth: number,
): void {
  segments.push(segment);
  walkForSecrets(child, segments, depth + 1);
  segments.pop();
}

function walkForSecrets(value: unknown, segments: LeakPathSegment[], depth: number): void {
  // skip: nothing to walk at null/undefined leaves.
  if (value === null || value === undefined) return;

  if (isSecret(value)) {
    throw new InternalError({
      message:
        `[secrets] Secret<> leaked into response at ${formatLeakPath(segments)}. ` +
        "Feature code must call .reveal() and use the plaintext in an " +
        "external call (SMTP, HTTP header, etc.) — never return the branded " +
        "value, even unwrapped, unless you've stripped it from the response first.",
    });
  }

  // skip: hit the recursion cap. Cyclic or pathologically-deep input is
  // more likely than a legitimate 12-level-deep secret — trade coverage
  // for termination guarantees.
  if (depth >= MAX_DEPTH) return;

  const t = typeof value;
  // skip: primitives already handled by the isSecret check above — strings,
  // numbers, booleans can't hold a brand.
  if (t !== "object") return;

  // Map and Set get walked through their entries — a feature could legitimately
  // build either, and a custom toJSON could expand them onto the wire.
  // JSON.stringify-by-default produces "{}" for both, which would mask the
  // leak silently; we'd rather throw at the boundary than rely on that
  // accident.
  if (value instanceof Map) {
    let i = 0;
    for (const [k, v] of value) {
      walkChild(k, { mapEntry: i, part: "key" }, segments, depth);
      walkChild(v, { mapEntry: i, part: "val" }, segments, depth);
      i++;
    }
    // skip: map fully walked, nothing else at this level.
    return;
  }
  if (value instanceof Set) {
    let i = 0;
    for (const v of value) {
      walkChild(v, { setEntry: i }, segments, depth);
      i++;
    }
    // skip: set fully walked, nothing else at this level.
    return;
  }

  // Skip remaining class instances we can't introspect safely (Date, Buffer,
  // Temporal.Instant, custom domain classes, etc.). Plain objects have
  // Object.prototype or null prototype — that's what handler responses
  // serialize to JSON from.
  const proto = Object.getPrototypeOf(value);
  // skip: non-plain object (class instance). Brand check at entry already
  // verified it's not a Secret<>; anything else is opaque to us.
  if (proto !== null && proto !== Object.prototype && !Array.isArray(value)) {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkChild(value[i], i, segments, depth);
    }
    // skip: array fully walked, nothing else at this level.
    return;
  }

  const obj = value as Record<string, unknown>; // @cast-boundary recursive-walk
  for (const key of Object.keys(obj)) {
    walkChild(obj[key], key, segments, depth);
  }
}
