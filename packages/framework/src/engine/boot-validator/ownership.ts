import type { OwnershipMap, OwnershipRule } from "../ownership";
import type { ClaimKeyDefinition, FeatureDefinition } from "../types";

// --- Ownership rule validation (H.2) ---
//
// Walks every entity.access and every field.access map, resolves each
// FromRule against the cross-feature claim registry, and confirms the
// referenced column exists on the entity. Catches typos, renames, and
// cross-feature-claim-removal scenarios at boot instead of at request time.

export function validateOwnershipRules(
  feature: FeatureDefinition,
  allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition>,
  knownRoles: ReadonlySet<string>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const columnNames = new Set<string>(Object.keys(entity.fields));
    // Framework-managed columns that rules are allowed to reference too.
    // These are the base columns buildEntityTable adds unconditionally.
    const frameworkColumns = ["id", "tenantId", "version", "insertedAt", "modifiedAt"];
    for (const col of frameworkColumns) columnNames.add(col);

    // Entity-level access
    if (entity.access?.read) {
      checkOwnershipMap({
        map: entity.access.read,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `entity "${entityName}".access.read`,
        featureName: feature.name,
      });
    }
    if (entity.access?.write) {
      checkOwnershipMap({
        map: entity.access.write,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `entity "${entityName}".access.write`,
        featureName: feature.name,
      });
    }

    // Field-level access — OwnershipMap form goes through checkOwnershipMap,
    // legacy string[] through checkLegacyRoleList. Both enforce role-name
    // existence against knownRoles so typos fail loud.
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      checkFieldAccess({
        access: field.access?.read,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `${entityName}.${fieldName}.access.read`,
        featureName: feature.name,
      });
      checkFieldAccess({
        access: field.access?.write,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `${entityName}.${fieldName}.access.write`,
        featureName: feature.name,
      });
    }
  }
}

export function checkFieldAccess(args: {
  readonly access: OwnershipMap | readonly string[] | undefined;
  readonly columnNames: ReadonlySet<string>;
  readonly allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition>;
  readonly knownRoles: ReadonlySet<string>;
  readonly scope: string;
  readonly featureName: string;
}): void {
  // skip: no access rules on this field, nothing to validate
  if (!args.access) return;
  if (Array.isArray(args.access)) {
    // Legacy string[] form — every entry is a role name. Ref/column
    // validation is n/a here (no claim refs in this shape), but the
    // role-existence check applies.
    checkLegacyRoleList(
      args.access as readonly string[], // @cast-boundary schema-walk
      args.knownRoles,
      args.scope,
      args.featureName,
    );
    // skip: legacy form validated, OwnershipMap check below doesn't apply
    return;
  }
  checkOwnershipMap({
    map: args.access as OwnershipMap, // @cast-boundary schema-walk
    columnNames: args.columnNames,
    allClaimKeys: args.allClaimKeys,
    knownRoles: args.knownRoles,
    scope: args.scope,
    featureName: args.featureName,
  });
}

export function checkLegacyRoleList(
  roles: readonly string[],
  knownRoles: ReadonlySet<string>,
  scope: string,
  featureName: string,
): void {
  // skip: no handler-declared roles in this app, role-validation disabled
  if (!shouldValidateRoles(knownRoles)) return;
  for (const roleName of roles) {
    if (!knownRoles.has(roleName)) {
      throw new Error(buildUnknownRoleMessage(roleName, knownRoles, scope, featureName));
    }
  }
}

// Only validate role-existence when at least one handler in the system has
// declared a non-builtin role. Apps that run entirely on openToAll +
// system-role handlers don't benefit from role-typo detection and would
// otherwise get false-positive errors on every OwnershipMap — their
// knownRoles corpus is empty beyond "all"/"system", so any app-defined
// role would flag as unknown.
export function shouldValidateRoles(knownRoles: ReadonlySet<string>): boolean {
  for (const r of knownRoles) {
    if (r !== "all" && r !== "system") return true;
  }
  return false;
}

export function checkOwnershipMap(args: {
  readonly map: OwnershipMap;
  readonly columnNames: ReadonlySet<string>;
  readonly allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition>;
  readonly knownRoles: ReadonlySet<string>;
  readonly scope: string;
  readonly featureName: string;
}): void {
  for (const [roleName, rawRule] of Object.entries(args.map)) {
    // Role-existence check — typos like `{"Admi": "all"}` where no handler
    // or other map mentions "Admi" would otherwise silently grant nothing.
    // Skip when no app-defined roles exist anywhere (handler-less or
    // system-only apps — shouldValidateRoles returns false there).
    if (shouldValidateRoles(args.knownRoles) && !args.knownRoles.has(roleName)) {
      throw new Error(
        buildUnknownRoleMessage(roleName, args.knownRoles, args.scope, args.featureName),
      );
    }

    // @cast-boundary schema-walk — extracted from feature-config inspection
    const rule = rawRule as OwnershipRule;
    if (rule === "all") continue;
    if (rule.kind === "where") continue; // escape hatch — feature author owns the SQL

    // FromRule — validate ref + column.
    if (rule.refKind === "claim") {
      // refPath is the qualified claim name ("feature:shortName").
      const claim = args.allClaimKeys.get(rule.refPath);
      if (!claim) {
        const known = [...args.allClaimKeys.keys()].sort().join(", ") || "(none)";
        throw new Error(
          `[Kumiko Ownership] ${args.scope} references unknown claim "${rule.refPath}" ` +
            `(role: "${roleName}", feature: "${args.featureName}"). ` +
            `Declare it via r.claimKey("...", { type: "..." }) in the owning feature. ` +
            `Known claims: ${known}`,
        );
      }
      // String-compatible columns accept string and string[] claims equally
      // (array → inArray). For other claim types we rely on the author
      // knowing the row-column shape; we can't introspect PG types without
      // the schema built. This is a best-effort ref-existence check.
    }

    if (!args.columnNames.has(rule.column)) {
      const known = [...args.columnNames].sort().join(", ");
      throw new Error(
        `[Kumiko Ownership] ${args.scope} references column "${rule.column}" ` +
          `which does not exist on the entity (role: "${roleName}", feature: ` +
          `"${args.featureName}"). Available columns: ${known}`,
      );
    }
  }
}

export function buildUnknownRoleMessage(
  roleName: string,
  knownRoles: ReadonlySet<string>,
  scope: string,
  featureName: string,
): string {
  const known = [...knownRoles].sort().join(", ");
  return (
    `[Kumiko Ownership] ${scope} references unknown role "${roleName}" ` +
    `(feature: "${featureName}"). Roles are collected from handler access ` +
    `rules across all features plus the "all" and "system" built-ins; if ` +
    `"${roleName}" is real, make sure at least one handler declares ` +
    `access.roles: ["${roleName}"]. Known roles: ${known}`
  );
}
