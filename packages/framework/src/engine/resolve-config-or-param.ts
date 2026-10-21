import type {
  ConfigAccessor,
  ConfigBounds,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigValue,
} from "./types/config.ts";
import type { Registry } from "./types/index.ts";

// Per-request config resolver for routes.
//
// Use case (configuration-layers.md, level 7): the caller wants to set a
// per-request value while the tenant admin sets the maximum bound.
// Example: `GET /files/:id/download-url?expiresSeconds=3600` — the client
// chooses 3600s, but if the tenant admin sets Max=1800, the helper clamps
// the value to 1800.
//
// Clamp rule: hard-clamp bounded numbers silently, unlike tenant-admin-SET,
// where rejection is appropriate. The caller often cannot control the exact
// value (it is preconfigured in the client SDK), and returning 422 for each
// download click would harm the user experience.
//
// Fallback cascade:
//   1. Valid paramValue → clamp and return
//   2. Missing or unparseable paramValue → ctx.config(handle)
//
// For select, only valid options are accepted; otherwise, fall back.
// For boolean, "true"/"1" → true; otherwise, false.
//
// ### text keys are locked
//
// Per-request overrides for `type="text"` are HARD-REJECTED because query
// parameter strings can contain XSS/SQL/command fragments, and this helper
// is a *parser*, not a *sanitizer*. Silent pass-through would be a footgun:
// an app developer could assume the param is active, allowing the unsanitized
// value to reach an HTML/SQL/shell context.
//
// The restriction applies only when actually attempting an override
// (paramValue is set). If paramValue is undefined/null/"", the helper returns
// the config value, so for text keys the function returns the same value as
// `ctx.config(handle)`.
//
// To accept a per-request text value, implement it explicitly in the route
// with an escaping strategy appropriate for the consumer (HTML encoder, SQL
// parameter binding, shell quoting).

type ResolveCtx = {
  readonly config: ConfigAccessor;
  readonly registry: Registry;
};

// Fires for every number-case clamp with the before/after values. Consumers
// typically wire this into a structured logger or a metric counter:
//   resolveConfigOrParam(ctx, handle, raw, {
//     onClamp: ({ key, original, clamped, max }) =>
//       ctx.logger?.warn("config.clamp", { key, original, clamped, max }),
//   });
// Without this hook a clamp is invisible — the caller just sees 1000 instead
// of the 9999 they sent, and debugging becomes guesswork.
export type ClampInfo = {
  readonly key: string;
  readonly original: number;
  readonly clamped: number;
  readonly min?: number;
  readonly max?: number;
};

export type ResolveOptions = {
  readonly onClamp?: (info: ClampInfo) => void;
};

export async function resolveConfigOrParam<T extends ConfigKeyType>(
  ctx: ResolveCtx,
  handle: ConfigKeyHandle<T>,
  paramValue: unknown,
  options?: ResolveOptions,
): Promise<ConfigValue<T> | undefined> {
  if (paramValue === undefined || paramValue === null || paramValue === "") {
    return ctx.config(handle);
  }

  const keyDef = ctx.registry.getConfigKey(handle.name);
  // skip: key isn't in the registry — unlikely because the caller holds a
  // typed handle, but defence-in-depth for hand-built handles.
  if (!keyDef) return ctx.config(handle);

  // Explicit opt-in required. A config key without `allowPerRequest: true`
  // on its declaration cannot be overridden via a query-param, even if the
  // route-handler forwards one. This is a deny-by-default policy: without
  // it, a future feature-dev could accidentally route a sensitive key
  // (rate-limits, quotas) through a public query-param without noticing.
  if (!keyDef.allowPerRequest) {
    throw new Error(
      `resolveConfigOrParam: per-request override not enabled for config key "${handle.name}". Set allowPerRequest: true on the declaration to opt in — or drop the paramValue if the route-handler forwards it by mistake.`,
    );
  }

  switch (keyDef.type) {
    case "number": {
      const parsed = typeof paramValue === "number" ? paramValue : Number(paramValue);
      if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        return ctx.config(handle);
      }
      const clamped = clampToBounds(parsed, keyDef.bounds);
      // Fire onClamp only when the value actually moved. No bounds + within
      // bounds = silent; crossing a bound = audit event.
      if (clamped !== parsed && options?.onClamp) {
        const info: ClampInfo = {
          key: handle.name,
          original: parsed,
          clamped,
          ...(keyDef.bounds?.min !== undefined && { min: keyDef.bounds.min }),
          ...(keyDef.bounds?.max !== undefined && { max: keyDef.bounds.max }),
        };
        options.onClamp(info);
      }
      return clamped as ConfigValue<T>; // @cast-boundary engine-bridge
    }

    case "boolean": {
      if (typeof paramValue === "boolean") return paramValue as ConfigValue<T>; // @cast-boundary engine-bridge
      const str = String(paramValue).toLowerCase();
      return (str === "true" || str === "1") as ConfigValue<T>; // @cast-boundary engine-bridge
    }

    case "text": {
      // Hard-reject any attempt to override a text key via query-param.
      // See the module-level comment for why this is strict. App-devs
      // that see this error should either (a) remove the paramValue from
      // their route — the config value still flows through ctx.config —
      // or (b) build their own sanitised parser outside this helper.
      throw new Error(
        `resolveConfigOrParam: per-request override is not allowed for type="text" config key "${handle.name}" — query-params would bypass sanitisation. Remove the paramValue or build a feature-specific sanitiser.`,
      );
    }

    case "select": {
      const str = String(paramValue);
      if (keyDef.options?.includes(str)) return str as ConfigValue<T>; // @cast-boundary engine-bridge
      // Invalid option → fall back to the configured value rather than 400.
      // The caller is signalling intent; we honour the constraint instead.
      return ctx.config(handle);
    }
    default: {
      const _exhaustive: never = keyDef.type;
      throw new Error(`resolveConfigOrParam: unhandled config key type "${_exhaustive}"`);
    }
  }
}

function clampToBounds(value: number, bounds: ConfigBounds | undefined): number {
  if (!bounds) return value;
  let v = value;
  if (bounds.min !== undefined && v < bounds.min) v = bounds.min;
  if (bounds.max !== undefined && v > bounds.max) v = bounds.max;
  return v;
}
