#!/usr/bin/env bun
// feature-factory — the bundled-feature constants (`tagsFeature`, ...) became factories
// (`createTagsFeature()`); the constants stay as deprecated aliases for one release.
//
// Usage:
//   bun scripts/codemod/feature-factory.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import {
  type ImportDeclaration,
  type ImportSpecifier,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  type CodemodResult,
  type CodemodSite,
  hasImportBinding,
  removeNamedImport,
  runCodemodCli,
  type SiteLists,
  sourceRelativeModule,
} from "./codemod-support.ts";

export interface FeatureFactoryEntry {
  readonly factory: string;
  readonly folder: string;
}

const BUNDLED_PACKAGE = "@cosmicdrift/kumiko-bundled-features";
const BUNDLED_SRC_MARKER = "/packages/bundled-features/src/";

// fileProviderS3EnvFeature is not listed: s3-imports.ts folds it into createFileProviderS3Feature.
export const FEATURE_FACTORIES: Readonly<Record<string, FeatureFactoryEntry>> = {
  authFoundationFeature: { factory: "createAuthFoundationFeature", folder: "auth-foundation" },
  authMfaUserDataFeature: {
    factory: "createAuthMfaUserDataFeature",
    folder: "auth-mfa-user-data",
  },
  billingFoundationFeature: {
    factory: "createBillingFoundationFeature",
    folder: "billing-foundation",
  },
  capCounterFeature: { factory: "createCapCounterFeature", folder: "cap-counter" },
  complianceProfilesOpsFeature: {
    factory: "createComplianceProfilesOpsFeature",
    folder: "compliance-profiles-ops",
  },
  customFieldsFeature: { factory: "createCustomFieldsFeature", folder: "custom-fields" },
  derivativesSharpFeature: {
    factory: "createDerivativesSharpFeature",
    folder: "derivatives-sharp",
  },
  documentIngestFoundationFeature: {
    factory: "createDocumentIngestFoundationFeature",
    folder: "document-ingest-foundation",
  },
  fileDerivativesFeature: {
    factory: "createFileDerivativesFeature",
    folder: "file-derivatives",
  },
  fileFoundationFeature: { factory: "createFileFoundationFeature", folder: "file-foundation" },
  fileProviderInMemoryFeature: {
    factory: "createFileProviderInMemoryFeature",
    folder: "file-provider-inmemory",
  },
  fileProviderS3Feature: { factory: "createFileProviderS3Feature", folder: "file-provider-s3" },
  foldersFeature: { factory: "createFoldersFeature", folder: "folders" },
  foldersUserDataFeature: {
    factory: "createFoldersUserDataFeature",
    folder: "folders-user-data",
  },
  formDraftFeature: { factory: "createFormDraftFeature", folder: "form-draft" },
  formDraftUserDataFeature: {
    factory: "createFormDraftUserDataFeature",
    folder: "form-draft-user-data",
  },
  inboundMailFoundationFeature: {
    factory: "createInboundMailFoundationFeature",
    folder: "inbound-mail-foundation",
  },
  inboundProviderImapFeature: {
    factory: "createInboundProviderImapFeature",
    folder: "inbound-provider-imap",
  },
  inboundProviderInMemoryFeature: {
    factory: "createInboundProviderInMemoryFeature",
    folder: "inbound-provider-inmemory",
  },
  ledgerFeature: { factory: "createLedgerFeature", folder: "ledger" },
  mailFoundationFeature: { factory: "createMailFoundationFeature", folder: "mail-foundation" },
  mailTransportInMemoryFeature: {
    factory: "createMailTransportInMemoryFeature",
    folder: "mail-transport-inmemory",
  },
  mailTransportSmtpFeature: {
    factory: "createMailTransportSmtpFeature",
    folder: "mail-transport-smtp",
  },
  notesHistoryFeature: { factory: "createNotesHistoryFeature", folder: "notes-history" },
  notesHistoryUserDataFeature: {
    factory: "createNotesHistoryUserDataFeature",
    folder: "notes-history-user-data",
  },
  readinessFeature: { factory: "createReadinessFeature", folder: "readiness" },
  tagsFeature: { factory: "createTagsFeature", folder: "tags" },
  templateResolverUserDataFeature: {
    factory: "createTemplateResolverUserDataFeature",
    folder: "template-resolver-user-data",
  },
  tenantSettingsFeature: { factory: "createTenantSettingsFeature", folder: "tenant-settings" },
  tierEngineFeature: { factory: "createTierEngineFeature", folder: "tier-engine" },
  workflowRunnerFeature: { factory: "createWorkflowRunnerFeature", folder: "workflow-runner" },
};

const CHEAP_PREFILTER = new RegExp(`\\b(${Object.keys(FEATURE_FACTORIES).join("|")})\\b`);
const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/framework/src/scripts/codemod/feature-factory.ts",
  "packages/framework/src/__tests__/feature-factory-codemod.test.ts",
];

const IDENTITY_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
]);
// Identity-comparing calls: a fresh factory result never matches the instance it is compared to.
const IDENTITY_METHODS: ReadonlySet<string> = new Set([
  "toBe",
  "toContain",
  "includes",
  "indexOf",
  "lastIndexOf",
  "has",
]);

function bundledModuleFolder(specifier: string, filePath: string): string | undefined {
  if (specifier.startsWith(`${BUNDLED_PACKAGE}/`))
    return specifier.slice(BUNDLED_PACKAGE.length + 1);
  const relativeModule = sourceRelativeModule(specifier, filePath, BUNDLED_SRC_MARKER);
  return relativeModule?.module.replace(/\/(feature|index)$/, "");
}

function isIdentityUse(reference: Node): boolean {
  const parent = reference.getParent();
  if (Node.isBinaryExpression(parent)) {
    return IDENTITY_OPERATORS.has(parent.getOperatorToken().getKind());
  }
  if (!Node.isCallExpression(parent) || !parent.getArguments().includes(reference)) return false;
  const callee = parent.getExpression();
  return (
    callee.getText() === "Object.is" ||
    (Node.isPropertyAccessExpression(callee) && IDENTITY_METHODS.has(callee.getName()))
  );
}

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface Candidate {
  readonly declarationIndex: number;
  readonly importedName: string;
  readonly entry: FeatureFactoryEntry;
}

function referenceEdit(reference: Node, entry: FeatureFactoryEntry): TextEdit | "manual-export" {
  const parent = reference.getParent();
  if (Node.isTypeQuery(parent)) {
    return {
      start: parent.getStart(),
      end: parent.getEnd(),
      text: `ReturnType<typeof ${entry.factory}>`,
    };
  }
  if (Node.isShorthandPropertyAssignment(parent)) {
    return {
      start: reference.getStart(),
      end: reference.getEnd(),
      text: `${reference.getText()}: ${entry.factory}()`,
    };
  }
  if (Node.isExportSpecifier(parent)) return "manual-export";
  return { start: reference.getStart(), end: reference.getEnd(), text: `${entry.factory}()` };
}

function site(file: string, node: Node, description: string): CodemodSite {
  return { file, line: node.getStartLineNumber(), description };
}

function findCandidates(
  sourceFile: SourceFile,
  filePath: string,
  result: SiteLists,
): { candidates: Candidate[]; declarations: ImportDeclaration[] } {
  const declarations = sourceFile.getImportDeclarations();
  const candidates: Candidate[] = [];
  for (const [declarationIndex, declaration] of declarations.entries()) {
    const specifier = declaration.getModuleSpecifierValue();
    const folder = bundledModuleFolder(specifier, filePath);
    if (folder === undefined) continue;
    for (const named of declaration.getNamedImports()) {
      const entry = FEATURE_FACTORIES[named.getName()];
      if (entry === undefined) continue;
      if (entry.folder !== folder) {
        result.manual.push(
          site(
            filePath,
            named,
            `${named.getName()} imported from ${specifier}: expected ${BUNDLED_PACKAGE}/${entry.folder}, use ${entry.factory}() by hand`,
          ),
        );
        continue;
      }
      if (named.getAliasNode() !== undefined) {
        result.manual.push(
          site(
            filePath,
            named,
            `${named.getName()} is imported under an alias: import ${entry.factory} and call it by hand`,
          ),
        );
        continue;
      }
      candidates.push({ declarationIndex, importedName: named.getName(), entry });
    }
  }
  return { candidates, declarations };
}

function referencesOutsideImports(specifier: ImportSpecifier): Node[] {
  const importDeclaration = specifier.getImportDeclaration();
  const nameNode = specifier.getNameNode();
  if (!Node.isIdentifier(nameNode)) return [];
  return nameNode
    .findReferencesAsNodes()
    .filter(
      (reference) =>
        reference.getFirstAncestor((ancestor) => ancestor === importDeclaration) === undefined,
    );
}

function collectEdits(
  candidates: readonly Candidate[],
  declarations: readonly ImportDeclaration[],
  filePath: string,
  result: SiteLists,
): { edits: TextEdit[]; applied: Candidate[] } {
  const edits: TextEdit[] = [];
  const applied: Candidate[] = [];
  for (const candidate of candidates) {
    const named = declarations[candidate.declarationIndex]
      ?.getNamedImports()
      .find((n) => n.getName() === candidate.importedName);
    if (named === undefined) continue;
    const references = referencesOutsideImports(named);
    const identityUse = references.find(isIdentityUse);
    if (identityUse !== undefined) {
      result.manual.push(
        site(
          filePath,
          identityUse,
          `${candidate.importedName} is compared by identity; ${candidate.entry.factory}() returns a new instance`,
        ),
      );
      continue;
    }
    const candidateEdits: TextEdit[] = [];
    for (const reference of references) {
      const edit = referenceEdit(reference, candidate.entry);
      if (edit === "manual-export") {
        result.manual.push(
          site(
            filePath,
            reference,
            `${candidate.importedName} is exported from this module: export ${candidate.entry.factory} as well`,
          ),
        );
        continue;
      }
      candidateEdits.push(edit);
      result.rewrites.push(
        site(filePath, reference, `${candidate.importedName} -> ${candidate.entry.factory}()`),
      );
    }
    edits.push(...candidateEdits);
    applied.push(candidate);
  }
  return { edits, applied };
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let output = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

function renameImports(
  sourceFile: SourceFile,
  applied: readonly Candidate[],
  filePath: string,
  result: SiteLists,
): void {
  for (const { importedName, entry } of applied) {
    const declaration = sourceFile
      .getImportDeclarations()
      .find((d) => d.getNamedImports().some((n) => n.getName() === importedName));
    const named = declaration?.getNamedImports().find((n) => n.getName() === importedName);
    if (declaration === undefined || named === undefined) continue;
    result.rewrites.push(site(filePath, named, `import ${importedName} -> ${entry.factory}`));
    if (hasImportBinding(sourceFile, entry.factory)) {
      removeNamedImport(sourceFile, declaration, named);
    } else {
      named.getNameNode().replaceWithText(entry.factory);
    }
  }
}

function reportNamespaceAccesses(
  sourceFile: SourceFile,
  filePath: string,
  result: SiteLists,
): void {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const namespace = declaration.getNamespaceImport();
    const folder = bundledModuleFolder(declaration.getModuleSpecifierValue(), filePath);
    if (namespace === undefined || folder === undefined) continue;
    for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const entry = FEATURE_FACTORIES[access.getName()];
      if (entry?.folder === folder && access.getExpression().getText() === namespace.getText()) {
        result.manual.push(
          site(
            filePath,
            access,
            `${access.getText()}: call ${namespace.getText()}.${entry.factory}()`,
          ),
        );
      }
    }
  }
}

function reportReexports(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const folder = specifier === undefined ? undefined : bundledModuleFolder(specifier, filePath);
    if (folder === undefined) continue;
    const exported = declaration.getNamedExports().map((e) => e.getName());
    for (const name of exported) {
      const entry = FEATURE_FACTORIES[name];
      if (entry?.folder !== folder || exported.includes(entry.factory)) continue;
      result.manual.push(
        site(
          filePath,
          declaration,
          `${name} re-exported from ${specifier}: re-export ${entry.factory}`,
        ),
      );
    }
  }
}

function reportDynamicImports(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const argument = call.getArguments()[0];
    if (argument === undefined || !Node.isStringLiteral(argument)) continue;
    const folder = bundledModuleFolder(argument.getLiteralValue(), filePath);
    const touchesFolder = Object.values(FEATURE_FACTORIES).some((entry) => entry.folder === folder);
    if (touchesFolder) {
      result.manual.push(
        site(
          filePath,
          call,
          `dynamic import of ${argument.getLiteralValue()}: use the create*Feature factory by hand`,
        ),
      );
    }
  }
}

export function transformFeatureFactorySource(
  source: string,
  filePath = "source.ts",
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  reportNamespaceAccesses(sourceFile, filePath, result);
  reportReexports(sourceFile, filePath, result);
  reportDynamicImports(sourceFile, filePath, result);
  const { candidates, declarations } = findCandidates(sourceFile, filePath, result);
  const { edits, applied } = collectEdits(candidates, declarations, filePath, result);
  if (applied.length === 0) return { output: source, ...result };
  const withReferences = project.createSourceFile(
    `${filePath}.rewritten.ts`,
    applyEdits(source, edits),
  );
  renameImports(withReferences, applied, filePath, result);
  return { output: withReferences.getFullText(), ...result };
}

function isSkippedPath(file: string): boolean {
  return SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "feature-factory",
      transform: transformFeatureFactorySource,
      isSkippedPath,
    },
    process.argv.slice(2),
  );
}
