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
// Bei text: param wird durchgereicht (kein Sanitising).
// Bei boolean: "true"/"1" → true, sonst false.

type ResolveCtx = {
  readonly config: ConfigAccessor;
  readonly registry: Registry;
};

export async function resolveConfigOrParam<T extends ConfigKeyType>(
  ctx: ResolveCtx,
  handle: ConfigKeyHandle<T>,
  paramValue: unknown,
): Promise<ConfigValue<T> | undefined> {
  if (paramValue === undefined || paramValue === null || paramValue === "") {
    return ctx.config(handle);
  }

  const keyDef = ctx.registry.getConfigKey(handle.name);
  // skip: key isn't in the registry — unlikely because the caller holds a
  // typed handle, but defence-in-depth for hand-built handles.
  if (!keyDef) return ctx.config(handle);

  switch (keyDef.type) {
    case "number": {
      const parsed = typeof paramValue === "number" ? paramValue : Number(paramValue);
      if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        return ctx.config(handle);
      }
      return clampToBounds(parsed, keyDef.bounds) as ConfigValue<T>;
    }

    case "boolean": {
      if (typeof paramValue === "boolean") return paramValue as ConfigValue<T>;
      const str = String(paramValue).toLowerCase();
      return (str === "true" || str === "1") as ConfigValue<T>;
    }

    case "text":
      return String(paramValue) as ConfigValue<T>;

    case "select": {
      const str = String(paramValue);
      if (keyDef.options?.includes(str)) return str as ConfigValue<T>;
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
