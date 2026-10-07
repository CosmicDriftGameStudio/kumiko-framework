import type { OwnershipMap } from "@cosmicdrift/kumiko-framework/engine";

// Boot validation rejects `{ kind: "where" }` in access.write too (fw#2626);
// failing at factory time names the option instead of an entity scope.
export function assertNoWhereRuleInOwnershipWrite(
  factoryName: string,
  writeOwnership: OwnershipMap | undefined,
): void {
  // skip: no write ownership declared, nothing to validate
  if (!writeOwnership) return;
  const hasWhereRule = Object.values(writeOwnership).some(
    (rule) => rule !== "all" && rule.kind === "where",
  );
  // skip: no where-rule present, the option is valid
  if (!hasWhereRule) return;
  throw new Error(
    `${factoryName}({ ownership }): ownership.write must not contain a ` +
      '`{ kind: "where" }` rule — where-rules are evaluated only at the SQL ' +
      "layer (the read path, via buildOwnershipClause). Write paths that " +
      "consult access.write (userCanCreateFieldRow/userCanWriteFieldRow) can't " +
      "evaluate them, so such a rule can only ever deny — boot validation " +
      "rejects it too (fw#2626). Use a `from()` rule for ownership.write, or " +
      "leave it unset.",
  );
}
