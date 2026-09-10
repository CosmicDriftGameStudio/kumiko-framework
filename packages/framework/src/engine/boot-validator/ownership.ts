import { buildEntityTable } from "../../db/table-builder";
import type { OwnershipMap, OwnershipRule, SqlFragment, WhereRule } from "../ownership";
import { SYSTEM_USER_ID } from "../system-user";
import type { ClaimKeyDefinition, FeatureDefinition, SessionUser } from "../types";
import { SYSTEM_TENANT_ID } from "../types/identifiers";
import { assertQualifiedWhereFragment, tableColumnSqlNames } from "../where-rule-lint";

// --- Ownership rule validation (H.2) ---
//
// Walks every entity.access and every field.access map, resolves each
// FromRule against the cross-feature claim registry, and confirms the
// referenced column exists on the entity. Catches typos, renames, and
// cross-feature-claim-removal scenarios at boot instead of at request time.
//
// fw#2639: also probes every `{ kind: "where" }` rule against the where-rule
// lint (see ../where-rule-lint.ts) so a fail-open unqualified-column bug
// fails the boot instead of waiting for a request from the right role.
//
// fw#2626: `access.write` maps reject `{ kind: "where" }` outright. A
// where-rule is raw SQL and the write path never reaches SQL — it evaluates
// rules in memory against the concrete row (userCanCreateFieldRow /
// userCanWriteFieldRow), and a create has no row to run a predicate against
// at all. Such a rule can therefore only ever deny, so the boot fails instead
// of shipping an access map that silently locks the role out.

// A rule that reads real claims off the user can't be evaluated at boot —
// PROBE_USER carries none — so probing is best-effort: rules that throw on
// the probe user fall through to the runtime backstop in
// ownership.ts#ruleToFragment instead.
const PROBE_USER: SessionUser = {
  id: SYSTEM_USER_ID,
  tenantId: SYSTEM_TENANT_ID,
  roles: [],
  claims: {},
};

export type WhereRuleProbe = {
  readonly table: unknown;
  readonly tableName: string;
  readonly columns: ReadonlySet<string>;
};

// Which half of an access map is being validated. Only "read" ever reaches
// SQL, so it is the only path on which a where-rule is admissible.
export type AccessPath = "read" | "write";

// Qualified-name → definition map of every claim key in the mounted feature
// set. `from("claim:<feature>:<key>")` rules resolve against exactly this.
export function collectClaimKeys(
  features: readonly FeatureDefinition[],
): Map<string, ClaimKeyDefinition> {
  const claimKeys = new Map<string, ClaimKeyDefinition>();
  for (const f of features) {
    for (const def of Object.values(f.claimKeys)) {
      claimKeys.set(def.qualifiedName, def);
    }
  }
  return claimKeys;
}

// Subset-safe ownership validation for callers that mount a deliberate slice
// of the app rather than all of it (setupTestStack). Both cross-feature
// corpora go in as undefined — a three-feature stack genuinely does not know
// which roles and claims the whole app declares, and answering that question
// from a slice produces false "unknown role"/"unknown claim" errors. The
// subset-invariant checks (#2639 where-lint, #2626 where-on-write, unknown
// column) run in full: those hold or fail per feature, whatever else is
// mounted.
export function validateOwnershipBoot(features: readonly FeatureDefinition[]): void {
  for (const feature of features) {
    validateOwnershipRules(feature, undefined, undefined);
  }
}

// undefined corpus = "this caller cannot answer that question", not "skip the
// check" — see validateOwnershipBoot. validateBoot passes the real corpora.
export function validateOwnershipRules(
  feature: FeatureDefinition,
  allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition> | undefined,
  knownRoles: ReadonlySet<string> | undefined,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const columnNames = new Set<string>(Object.keys(entity.fields));
    // Framework-managed columns that rules are allowed to reference too.
    // These are the base columns buildEntityTable adds unconditionally.
    const frameworkColumns = ["id", "tenantId", "version", "insertedAt", "modifiedAt"];
    for (const col of frameworkColumns) columnNames.add(col);

    let probe: WhereRuleProbe | undefined;
    try {
      const table = buildEntityTable(entityName, entity);
      const columns = tableColumnSqlNames(table);
      if (columns.size > 0) {
        probe = { table, tableName: entity.table ?? entityName, columns };
      }
    } catch {
      // skip: table cannot be built outside the real boot sequence here —
      // the runtime backstop in ruleToFragment still covers this entity.
      probe = undefined;
    }

    // Entity-level access
    if (entity.access?.read) {
      checkOwnershipMap({
        map: entity.access.read,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `entity "${entityName}".access.read`,
        featureName: feature.name,
        probe,
        path: "read",
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
        probe,
        path: "write",
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
        probe,
        path: "read",
      });
      checkFieldAccess({
        access: field.access?.write,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `${entityName}.${fieldName}.access.write`,
        featureName: feature.name,
        probe,
        path: "write",
      });
    }
  }
}

export function checkFieldAccess(args: {
  readonly access: OwnershipMap | readonly string[] | undefined;
  readonly columnNames: ReadonlySet<string>;
  readonly allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition> | undefined;
  readonly knownRoles: ReadonlySet<string> | undefined;
  readonly scope: string;
  readonly featureName: string;
  readonly probe?: WhereRuleProbe;
  readonly path: AccessPath;
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
    probe: args.probe,
    path: args.path,
  });
}

export function checkLegacyRoleList(
  roles: readonly string[],
  knownRoles: ReadonlySet<string> | undefined,
  scope: string,
  featureName: string,
): void {
  // skip: corpus cannot answer "is this role real?" — see canValidateRoles
  if (!canValidateRoles(knownRoles)) return;
  for (const roleName of roles) {
    if (!knownRoles.has(roleName)) {
      throw new Error(buildUnknownRoleMessage(roleName, knownRoles, scope, featureName));
    }
  }
}

// A role corpus can only answer "is this role real?" when it actually holds
// app-defined roles. undefined means the caller could not derive one at all
// (a test stack mounts a deliberate subset of the app), and a corpus of
// nothing but "all"/"system" belongs to an app whose handlers never declare
// a role — in both cases every app-defined role would flag as unknown.
export function canValidateRoles(
  knownRoles: ReadonlySet<string> | undefined,
): knownRoles is ReadonlySet<string> {
  if (!knownRoles) return false;
  for (const r of knownRoles) {
    if (r !== "all" && r !== "system") return true;
  }
  return false;
}

export function checkOwnershipMap(args: {
  readonly map: OwnershipMap;
  readonly columnNames: ReadonlySet<string>;
  readonly allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition> | undefined;
  readonly knownRoles: ReadonlySet<string> | undefined;
  readonly scope: string;
  readonly featureName: string;
  readonly probe?: WhereRuleProbe;
  readonly path: AccessPath;
}): void {
  for (const [roleName, rawRule] of Object.entries(args.map)) {
    // Role-existence check — typos like `{"Admi": "all"}` where no handler
    // or other map mentions "Admi" would otherwise silently grant nothing.
    // Cross-feature, so it needs a corpus that can answer the question.
    if (canValidateRoles(args.knownRoles) && !args.knownRoles.has(roleName)) {
      throw new Error(
        buildUnknownRoleMessage(roleName, args.knownRoles, args.scope, args.featureName),
      );
    }

    // @cast-boundary schema-walk — extracted from feature-config inspection
    const rule = rawRule as OwnershipRule;
    if (rule === "all") continue;
    if (rule.kind === "where") {
      if (args.path === "write") {
        throw new Error(buildWhereOnWritePathMessage(roleName, args.scope, args.featureName));
      }
      probeWhereRule(rule, roleName, args.probe, args.scope, args.featureName);
      continue; // escape hatch — feature author owns the SQL
    }

    // FromRule — validate ref + column.
    // Claim-existence is cross-feature: only the whole-app corpus can tell a
    // typo from a claim declared in a feature this caller did not mount.
    if (rule.refKind === "claim" && args.allClaimKeys) {
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

// Best-effort: run the where-rule lint against the SQL the rule produces
// for PROBE_USER. A rule that needs real claims throws on that call and is
// silently skipped — ruleToFragment's runtime backstop is what catches it.
export function probeWhereRule(
  rule: WhereRule,
  roleName: string,
  probe: WhereRuleProbe | undefined,
  scope: string,
  featureName: string,
): void {
  // skip: no probe means the entity's column set could not be derived above;
  // without it there is nothing to check the rule's SQL against, so the
  // runtime backstop in ruleToFragment is the only line of defense left.
  if (!probe) return;
  let fragment: SqlFragment;
  try {
    fragment = rule.where(PROBE_USER, {
      table: probe.table,
      tableName: probe.tableName,
      paramStart: 1,
    });
  } catch {
    // skip: a rule that needs real claims cannot be probed at boot; ruleToFragment is the backstop
    return;
  }
  // skip: a rule producing no SQL fragment for the probe user has nothing to
  // lint here; ruleToFragment still validates it against a real request.
  if (typeof fragment?.sqlText !== "string") return;
  assertQualifiedWhereFragment(
    fragment.sqlText,
    probe.columns,
    `${scope} (role "${roleName}", feature: "${featureName}")`,
  );
}

export function buildWhereOnWritePathMessage(
  roleName: string,
  scope: string,
  featureName: string,
): string {
  return (
    `[Kumiko Ownership] ${scope} uses a \`{ kind: "where" }\` rule for role ` +
    `"${roleName}" (feature: "${featureName}"). where-rules are raw SQL and only ` +
    `the read path runs SQL (buildOwnershipClause); write access is decided in ` +
    `memory against the concrete row, and a create has no row yet — so the rule ` +
    `could only ever deny this role. Use a from()-rule (e.g. ` +
    `from("user:id", "ownerId") or from("claim:<feature>:<key>")) on access.write, ` +
    `or enforce the condition in the write-handler's preSave hook. ` +
    `where-rules stay supported on access.read.`
  );
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
