import type { Registry } from "./types";
import type {
  ConfigAccessor,
  ConfigBounds,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigValue,
} from "./types/config";

// Per-Request Config-Resolver für Routes.
//
// Use-case (aus configuration-layers.md, Ebene 7): der Caller will pro
// Request einen Wert setzen, den Tenant-Admin aber den Max-Bound festlegen.
// Beispiel: `GET /files/:id/download-url?expiresSeconds=3600` — Client
// wählt 3600s, aber wenn Tenant-Admin Max=1800 gesetzt hat, clampt der
// Helper auf 1800.
//
// Clamp-Regel: hard-clamp für number mit bounds. Silent — im Gegensatz zu
// tenant-admin-SET (dort ist reject richtig). Caller hat oft keine Kontrolle
// über den genauen Wert (voreingestellt im Client-SDK), und ein 422 pro
// Download-Klick wäre UX-Gift.
//
// Fallback-Cascade:
//   1. paramValue valide → clamp + return
//   2. paramValue fehlt / nicht parseable → ctx.config(handle)
//
// Bei select: nur valide Options werden akzeptiert, sonst Fallback.
// Bei boolean: "true"/"1" → true, sonst false.
//
// ### text-Keys sind gesperrt
//
// Per-Request-Overrides für `type="text"` werden HART ABGELEHNT. Grund:
// Query-Param-Strings können XSS/SQL/Command-Fragmente enthalten, und
// dieser Helper ist ein *Parser*, kein *Sanitizer*. Ein silent-pass-through
// wäre ein Footgun — App-Dev würde denken "param ist aktiv" und der
// unsanitized Wert landet in HTML/SQL/Shell-Kontext.
//
// Die Sperre gilt nur beim tatsächlichen Override-Versuch (paramValue
// gesetzt). Wenn paramValue undefined/null/"" ist, gibt der Helper den
// Config-Wert zurück — dann liefert die Funktion für text-Keys einfach
// denselben Wert wie `ctx.config(handle)`.
//
// Wer für text pro Request tatsächlich einen Wert akzeptieren will, baut
// das explizit in der Route mit eigener Escape-Strategie für den Consumer
// (HTML-Encoder, SQL-Parameter-Binding, Shell-Quoter).

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
  }
}

function clampToBounds(value: number, bounds: ConfigBounds | undefined): number {
  if (!bounds) return value;
  let v = value;
  if (bounds.min !== undefined && v < bounds.min) v = bounds.min;
  if (bounds.max !== undefined && v > bounds.max) v = bounds.max;
  return v;
}
