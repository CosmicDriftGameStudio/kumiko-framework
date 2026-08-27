#!/usr/bin/env bun
// Migrates create*Field(...) calls from the old flag-based PII API (pii,
// userOwned, tenantOwned, subjectRef, allowPlaintext, lookupable,
// searchable, sensitive) to the author-facing personal/find API
// (kumiko-framework#2250). Idempotent — re-running is a no-op on already
// migrated fields (skipped once a `personal` property is present).
//
// Mapping table (exact):
//   pii: true                           -> personal: "self"
//   userOwned: { ownerField: "x" }      -> personal: { of: "x" }
//   tenantOwned: true                   -> personal: "tenant"
//   subjectRef: true                    -> personal: "ref"
//   allowPlaintext: "R"                 -> personal: false, reason: "<R, normalized to snake_case>"
//   lookupable: true (alone)            -> find: "exact"
//   lookupable: true + searchable: true -> find: "fuzzy"
//   searchable: true (alone)            -> find: "fuzzy"
//   sensitive: true                     -> find: "secret"
//   none of the above                   -> find: "none"
// `find` only applies to text/longText fields, and only when the subject
// is neither "ref" nor `personal: false` (see PersonalAnnotations in
// packages/types/src/fields.ts). Never guesses: anything outside this
// table is reported (file:line) instead of transformed.
//
// Usage: bun scripts/codemod/pii-personal-migration.ts <targetDir> [--dry-run]

import { relative, resolve } from "node:path";
import { Glob } from "bun";
import {
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertyAssignment,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

const SUBJECT_FLAG_NAMES = [
  "pii",
  "userOwned",
  "tenantOwned",
  "subjectRef",
  "allowPlaintext",
] as const;
type SubjectFlagName = (typeof SUBJECT_FLAG_NAMES)[number];

// `create*Field` factories that accept `find` (text/longText) — see
// packages/framework/src/engine/factories.ts.
const TEXT_FIND_FACTORIES = new Set(["createTextField"]);
const LONGTEXT_FIND_FACTORIES = new Set(["createLongTextField"]);
// Accept `personal` but never `find` (PersonalAnnotationsNoFind).
const NO_FIND_FACTORIES = new Set([
  "createSelectField",
  "createMultiSelectField",
  "createNumberField",
  "createBigIntField",
  "createDecimalField",
  "createEmbeddedField",
  "createEmbeddedListField",
  "createJsonbField",
  "createDateField",
  "createTimestampField",
  "createTzField",
  "createLocatedTimestampField",
]);
// No personal-annotation support at all — a subject flag here is a bug.
const NO_PERSONAL_FACTORIES = new Set([
  "createBooleanField",
  "createMoneyField",
  "createFileField",
  "createImageField",
  "createFilesField",
  "createImagesField",
  "createDerivedField",
]);
// Overrides live in argument position 1, not 0.
const OVERRIDES_ARG_INDEX_1 = new Set(["createEmbeddedField", "createEmbeddedListField"]);

const FIELD_FACTORY_RE = /^create\w*Field$/;

type ReportEntry = { readonly file: string; readonly line: number; readonly note: string };
type FindBucket = "exact" | "fuzzy" | "none" | "secret" | "ref" | "personal-false" | "no-find";

const reports: ReportEntry[] = [];
const newLookupableSites: ReportEntry[] = [];
const counts: Record<FindBucket, number> = {
  exact: 0,
  fuzzy: 0,
  none: 0,
  secret: 0,
  ref: 0,
  "personal-false": 0,
  "no-find": 0,
};

function report(node: Node, reason: string): void {
  reports.push({
    file: node.getSourceFile().getFilePath(),
    line: node.getStartLineNumber(),
    reason,
  });
}

function isTrueLiteral(node: Node | undefined): boolean {
  return !!node && node.getKind() === SyntaxKind.TrueKeyword;
}

function findProp(obj: ObjectLiteralExpression, name: string): PropertyAssignment | undefined {
  const p = obj.getProperty(name);
  return p && Node.isPropertyAssignment(p) ? p : undefined;
}

// Reason-string convention (infra/guards/guard-error-reasons.ts):
// ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$ — lowercase snake_case, optional
// dot-namespacing. Old allowPlaintext values are free-form kebab-case.
function normalizeReasonSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  return /^[0-9]/.test(slug) ? `_${slug}` : slug;
}

type FieldCall = { readonly name: string; readonly objArg: ObjectLiteralExpression };

function collectFieldCalls(sourceFile: SourceFile): FieldCall[] {
  const calls: FieldCall[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprNode = call.getExpression();
    if (!Node.isIdentifier(exprNode)) continue;
    const name = exprNode.getText();
    // `createTenantConfig`/`createUserConfig`/etc. never match — they
    // don't end in "Field", so they're out of scope by construction.
    if (!FIELD_FACTORY_RE.test(name)) continue;

    const argIndex = OVERRIDES_ARG_INDEX_1.has(name) ? 1 : 0;
    const objArg = call.getArguments()[argIndex];
    if (objArg && Node.isObjectLiteralExpression(objArg)) {
      calls.push({ name, objArg });
    }
  }
  return calls;
}

function reportRawSubjectLiterals(
  sourceFile: SourceFile,
  handled: ReadonlySet<ObjectLiteralExpression>,
): void {
  for (const objLit of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    if (handled.has(objLit)) continue;
    const found = [...SUBJECT_FLAG_NAMES, "piiEncrypted"].filter((n) => objLit.getProperty(n));
    if (found.length > 0) {
      report(
        objLit,
        `subject flag(s) [${found.join(", ")}] on an object literal that is not a create*Field(...) call`,
      );
    }
  }
}

// kumiko-lint-ignore complexity-budget migration codemod, one-time script — splitting would add risk without benefit
function processObjectLiteral(obj: ObjectLiteralExpression, factoryName: string): void {
  // skip: field already carries `personal` — already migrated, idempotent no-op
  if (obj.getProperty("personal")) return;

  const piiEncryptedProp = obj.getProperty("piiEncrypted");
  if (piiEncryptedProp) {
    report(
      piiEncryptedProp,
      "piiEncrypted: true on an entity field (removed from the type system) — needs a human decision, not a mechanical mapping",
    );
    // skip: reported above — piiEncrypted needs a human decision, not a mechanical mapping
    return;
  }

  const subjectProps = SUBJECT_FLAG_NAMES.map((n) => ({ name: n, prop: findProp(obj, n) })).filter(
    (x): x is { name: SubjectFlagName; prop: PropertyAssignment } => !!x.prop,
  );
  const lookupableProp = findProp(obj, "lookupable");
  const searchableProp = findProp(obj, "searchable");
  const sensitiveProp = findProp(obj, "sensitive");
  const anonymizeProp = obj.getProperty("anonymize");

  if (subjectProps.length === 0) {
    // `searchable`/`sensitive` alone remain valid, unrelated FieldDef
    // properties — left untouched. `lookupable` alone can never compile
    // (always an excess property without a `personal` to attach `find`
    // to). `anonymize` alone has no PersonalAnnotations arm to live on.
    if (lookupableProp) {
      report(
        lookupableProp,
        "lookupable without any subject annotation — no `personal` to attach `find` to",
      );
    }
    if (anonymizeProp) {
      report(
        anonymizeProp,
        "anonymize without any subject annotation — no PersonalAnnotations arm accepts anonymize alone",
      );
    }
    // skip: no subject flag on this field — stray lookupable/anonymize already reported above if present
    return;
  }

  if (subjectProps.length > 1) {
    const first = subjectProps[0];
    if (first) {
      report(
        first.prop,
        `multiple subject annotations on one field (${subjectProps.map((s) => s.name).join(", ")}) — needs a human decision on which subject is correct`,
      );
    }
    // skip: reported above — multiple subject annotations need a human call on which one wins
    return;
  }

  const subject = subjectProps[0];
  if (!subject) {
    // skip: length===0 and length>1 already returned — empty [0] is unreachable
    return;
  }

  if (NO_PERSONAL_FACTORIES.has(factoryName)) {
    report(
      subject.prop,
      `${factoryName} has no personal-annotation support — subject flag "${subject.name}" cannot be expressed here`,
    );
    // skip: reported above — this factory has no personal-annotation support to migrate into
    return;
  }
  const isTextFind = TEXT_FIND_FACTORIES.has(factoryName);
  const isLongTextFind = LONGTEXT_FIND_FACTORIES.has(factoryName);
  const isNoFind = NO_FIND_FACTORIES.has(factoryName);
  if (!isTextFind && !isLongTextFind && !isNoFind) {
    report(
      subject.prop,
      `unrecognized field factory "${factoryName}" — cannot verify its PersonalAnnotations shape`,
    );
    // skip: reported above — unknown factory shape, cannot verify safely
    return;
  }

  let personalInit: string;
  let reasonInit: string | undefined;
  if (subject.name === "pii") {
    if (!isTrueLiteral(subject.prop.getInitializer())) {
      report(subject.prop, "pii is set to a non-`true` value — cannot infer intent");
      // skip: reported above — non-`true` pii value, can't infer intent
      return;
    }
    personalInit = `"self"`;
  } else if (subject.name === "tenantOwned") {
    if (!isTrueLiteral(subject.prop.getInitializer())) {
      report(subject.prop, "tenantOwned is set to a non-`true` value — cannot infer intent");
      // skip: reported above — non-`true` tenantOwned value, can't infer intent
      return;
    }
    personalInit = `"tenant"`;
  } else if (subject.name === "subjectRef") {
    if (!isTrueLiteral(subject.prop.getInitializer())) {
      report(subject.prop, "subjectRef is set to a non-`true` value — cannot infer intent");
      // skip: reported above — non-`true` subjectRef value, can't infer intent
      return;
    }
    personalInit = `"ref"`;
  } else if (subject.name === "allowPlaintext") {
    const init = subject.prop.getInitializer();
    if (!init) {
      report(subject.prop, "allowPlaintext has no value");
      // skip: reported above — allowPlaintext has no value to migrate
      return;
    }
    personalInit = "false";
    reasonInit = Node.isStringLiteral(init)
      ? `"${normalizeReasonSlug(init.getLiteralText())}"`
      : init.getText();
  } else {
    const init = subject.prop.getInitializer();
    if (!init || !Node.isObjectLiteralExpression(init)) {
      report(subject.prop, "userOwned value is not an object literal — cannot extract ownerField");
      // skip: reported above — userOwned value isn't an object literal, can't extract ownerField
      return;
    }
    const ownerFieldProp = findProp(init, "ownerField");
    const ownerFieldInit = ownerFieldProp?.getInitializer();
    if (!ownerFieldInit) {
      report(subject.prop, 'userOwned is missing an "ownerField" property');
      // skip: reported above — userOwned is missing its ownerField property
      return;
    }
    personalInit = `{ of: ${ownerFieldInit.getText()} }`;
  }

  const subjectIsRefOrPlaintext =
    subject.name === "subjectRef" || subject.name === "allowPlaintext";

  if (subjectIsRefOrPlaintext) {
    // These PersonalAnnotations arms carry no `find` field at all.
    if (lookupableProp) {
      report(
        lookupableProp,
        `lookupable combined with personal:${subject.name === "subjectRef" ? '"ref"' : "false"} — findability doesn't apply to this subject, table has no mapping`,
      );
      // skip: reported above — lookupable doesn't apply to this subject, no mapping to migrate
      return;
    }
    applyTransform(obj, [subject.prop], {
      personal: personalInit,
      reason: reasonInit,
      find: undefined,
    });
    counts[subject.name === "subjectRef" ? "ref" : "personal-false"]++;
    // skip: already transformed above — nothing left to check for this subject
    return;
  }

  if (isNoFind) {
    const stray = lookupableProp ?? searchableProp ?? sensitiveProp;
    if (stray) {
      report(
        stray,
        `${factoryName} has no \`find\` in its PersonalAnnotations — findability flag present on a non-text field`,
      );
      // skip: reported above — findability flag on a non-text field, no valid find to attach
      return;
    }
    applyTransform(obj, [subject.prop], {
      personal: personalInit,
      reason: undefined,
      find: undefined,
    });
    counts["no-find"]++;
    // skip: already transformed above — no-find factory has nothing further to check
    return;
  }

  const hasLookupable = !!lookupableProp;
  const hasSearchable = !!searchableProp;
  const hasSensitive = !!sensitiveProp;

  if (sensitiveProp && (hasLookupable || hasSearchable)) {
    report(
      sensitiveProp,
      'sensitive combined with lookupable/searchable — two find values ("secret" vs "exact"/"fuzzy"), needs a human decision',
    );
    // skip: reported above — sensitive plus lookupable/searchable is an ambiguous find value
    return;
  }

  let find: "exact" | "fuzzy" | "none" | "secret";
  if (hasSensitive) find = "secret";
  else if (hasLookupable && hasSearchable) find = "fuzzy";
  else if (hasLookupable) find = "exact";
  else if (hasSearchable) find = "fuzzy";
  else find = "none";

  if (isLongTextFind && (find === "exact" || find === "fuzzy")) {
    const findSite = lookupableProp ?? searchableProp;
    if (findSite) {
      report(
        findSite,
        'lookupable/searchable on createLongTextField — only "none"/"secret" are valid find values on longText',
      );
    }
    // skip: reported above — exact/fuzzy find isn't valid on createLongTextField
    return;
  }

  // searchable-alone -> "fuzzy" makes expandPersonalAnnotations add
  // `lookupable: true`, which the field didn't carry before — that's a
  // new `_bidx` column (DDL migration), tracked separately for the report.
  if (hasSearchable && !hasLookupable) {
    newLookupableSites.push({
      file: obj.getSourceFile().getFilePath(),
      line: subject.prop.getStartLineNumber(),
      // Guard keys on property name `reason`; this is console copy, not an error code.
      note: "needs a `_bidx` column migration",
    });
  }

  const removedProps = [subject.prop, lookupableProp, searchableProp, sensitiveProp].filter(
    (p): p is PropertyAssignment => !!p,
  );
  applyTransform(obj, removedProps, { personal: personalInit, reason: undefined, find });
  counts[find]++;
}

function applyTransform(
  obj: ObjectLiteralExpression,
  removedProps: readonly PropertyAssignment[],
  next: { personal: string; reason: string | undefined; find: string | undefined },
): void {
  const properties = obj.getProperties();
  // Call sites always pass at least subject.prop; without an anchor there is nowhere to insert.
  const anchor = removedProps[0];
  if (!anchor) {
    // skip: no removed prop to anchor inserts on — nothing to transform
    return;
  }
  const anchorIndex = properties.indexOf(anchor);
  const removedSet = new Set<PropertyAssignment>(removedProps);
  let insertIndex = 0;
  for (let i = 0; i < anchorIndex; i++) {
    if (!removedSet.has(properties[i] as PropertyAssignment)) insertIndex++;
  }

  for (const p of removedProps) p.remove();

  const newProps: { name: string; initializer: string }[] = [
    { name: "personal", initializer: next.personal },
  ];
  if (next.find) newProps.push({ name: "find", initializer: `"${next.find}"` });
  if (next.reason !== undefined) newProps.push({ name: "reason", initializer: next.reason });

  obj.insertPropertyAssignments(insertIndex, newProps);
}

function findTargetFiles(rootDir: string): string[] {
  const glob = new Glob("**/*.{ts,tsx}");
  // engine/factories.ts constructs raw ResolvedPiiFlags literals as the
  // *implementation* of expandPersonalAnnotations (personal -> flags) —
  // not an authored override, so it's not a migration target.
  const EXCLUDE = ["/node_modules/", "/dist/", "/build/", "/engine/factories.ts"];
  const files: string[] = [];
  for (const file of glob.scanSync({ cwd: rootDir, dot: false })) {
    const abs = resolve(rootDir, file);
    if (EXCLUDE.some((p) => abs.includes(p))) continue;
    files.push(abs);
  }
  return files.sort();
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  const rootDir = resolve(positional[0] ?? process.cwd());

  const files = findTargetFiles(rootDir);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  let touchedFiles = 0;
  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    const calls = collectFieldCalls(sourceFile);
    const handled = new Set(calls.map((c) => c.objArg));
    reportRawSubjectLiterals(sourceFile, handled);

    const countsBefore = { ...counts };
    for (const { name, objArg } of calls) processObjectLiteral(objArg, name);
    const changed = (Object.keys(counts) as FindBucket[]).some(
      (k) => counts[k] !== countsBefore[k],
    );

    if (changed) {
      touchedFiles++;
      if (!dryRun) sourceFile.saveSync();
    }
  }

  console.log(`\nScanned ${files.length} files under ${rootDir}${dryRun ? " (dry-run)" : ""}.`);
  console.log(`Touched ${touchedFiles} files.\n`);
  console.log("Transformed, by find/personal bucket:");
  for (const [bucket, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${bucket}: ${n}`);
  }
  console.log(`\nNewly gains lookupable (needs a _bidx migration): ${newLookupableSites.length}`);
  for (const r of newLookupableSites) {
    console.log(`  ${relative(rootDir, r.file)}:${r.line} — ${r.note}`);
  }
  console.log(`\nReported (not transformed): ${reports.length}`);
  for (const r of reports) {
    console.log(`  ${relative(rootDir, r.file)}:${r.line} — ${r.note}`);
  }
}

await main();
