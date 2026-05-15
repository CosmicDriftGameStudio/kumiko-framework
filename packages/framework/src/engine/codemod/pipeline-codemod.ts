import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Glob } from "bun";
import { type CallExpression, Project, type SourceFile, SyntaxKind } from "ts-morph";

export type CodemodResult = {
  readonly filePath: string;
  readonly status: "converted" | "skipped" | "error";
  readonly reason?: string;
};

export type CodemodReport = {
  readonly results: readonly CodemodResult[];
  readonly converted: number;
  readonly skipped: number;
  readonly errors: number;
};

export type CodemodOptions = {
  readonly dryRun?: boolean;
  readonly verbose?: boolean;
};

export type GuardConfig = {
  readonly condition: string;
  readonly failureReturn: string;
  readonly successReturn: string;
};

export type ParsedHandlerInfo = {
  readonly handlerBodyText: string;
  readonly isStaticReturn: boolean;
  readonly isSimpleExecutorCreate: boolean;
  readonly isSimpleExecutorUpdate: boolean;
  readonly hasConditionalLogic: boolean;
  readonly executorName?: string;
  readonly executorCreateVar?: string;
  readonly executorCreateArgs?: string[];
  readonly executorUpdateVar?: string;
  readonly isExpressionBodyCreate: boolean;
  readonly isExpressionBodyUpdate: boolean;
  readonly expressionBodyArgs: string[] | undefined;
  readonly isGuardedCreate: boolean;
  readonly guardConfig: GuardConfig | undefined;
};

export function analyzeHandlerArrow(arrowText: string): ParsedHandlerInfo {
  const text = arrowText.trim();

  let handlerBodyText: string;
  let isStaticReturn = false;
  let isSimpleExecutorCreate = false;
  let isSimpleExecutorUpdate = false;
  let hasConditionalLogic = false;
  let executorName: string | undefined;
  let executorCreateVar: string | undefined;
  let executorCreateArgs: string[] | undefined;
  let executorUpdateVar: string | undefined;
  let isExpressionBodyCreate = false;
  let isExpressionBodyUpdate = false;
  let expressionBodyArgs: string[] | undefined;
  let isGuardedCreate = false;
  let guardConfig: GuardConfig | undefined;

  if (text.startsWith("async (")) {
    const arrowIdx = text.indexOf("=>");
    if (arrowIdx === -1) {
      return {
        handlerBodyText: text,
        isStaticReturn: false,
        isSimpleExecutorCreate: false,
        isSimpleExecutorUpdate: false,
        hasConditionalLogic: false,
        isExpressionBodyCreate: false,
        isExpressionBodyUpdate: false,
        expressionBodyArgs: undefined,
        isGuardedCreate: false,
        guardConfig: undefined,
      };
    }
    const afterArrow = text.slice(arrowIdx + 2).trim();

    if (afterArrow.startsWith("(")) {
      isStaticReturn = true;
      handlerBodyText = afterArrow;
    } else if (afterArrow.startsWith("{")) {
      handlerBodyText = afterArrow;

      const lines = handlerBodyText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      // Detect conditional logic (if/try/for/while/catch)
      hasConditionalLogic = lines.some(
        (l) =>
          l.startsWith("if ") ||
          l.startsWith("try ") ||
          l.startsWith("for ") ||
          l.startsWith("while ") ||
          l.startsWith("} else"),
      );

      const createMatch = handlerBodyText.match(/const\s+(\w+)\s*=\s*await\s+(\w+)\.create\s*\(/);
      const updateMatch = handlerBodyText.match(/const\s+(\w+)\s*=\s*await\s+(\w+)\.update\s*\(/);
      const hasSimpleReturn = /return\s*\{[^}]*isSuccess:\s*true/.test(handlerBodyText);

      if (createMatch && hasSimpleReturn && !hasConditionalLogic) {
        isSimpleExecutorCreate = true;
        executorName = createMatch[2];
        executorCreateVar = createMatch[1];
        executorCreateArgs = extractArgs(handlerBodyText, createMatch[2] as string, "create");
      } else if (createMatch && hasSimpleReturn && hasConditionalLogic) {
        // Try to match the guard pattern: if (!<var>.isSuccess) { return fail } return success
        const guard = extractGuardedPattern(handlerBodyText, createMatch[1] as string);
        if (guard) {
          isGuardedCreate = true;
          guardConfig = guard;
          executorName = createMatch[2];
          executorCreateVar = createMatch[1];
          executorCreateArgs = extractArgs(handlerBodyText, createMatch[2] as string, "create");
        }
      }

      if (updateMatch && hasSimpleReturn && !hasConditionalLogic && !isSimpleExecutorCreate && !isGuardedCreate) {
        isSimpleExecutorUpdate = true;
        executorName = updateMatch[2];
        executorUpdateVar = updateMatch[1];
      }
    } else {
      handlerBodyText = afterArrow;
      // Expression body — check for member-call patterns like
      // `crud.create(event.payload)` or `crud.update({ id, changes })`.
      const exprCallMatch = afterArrow.match(/^(\w+)\.(create|update)\s*\(/);
      if (exprCallMatch) {
        executorName = exprCallMatch[1]!;
        const method = exprCallMatch[2]!;
        expressionBodyArgs = extractExprArgs(afterArrow, executorName, method);
        if (method === "create") {
          isExpressionBodyCreate = true;
        } else {
          isExpressionBodyUpdate = true;
        }
      } else if (afterArrow.startsWith("(") && afterArrow.endsWith(")")) {
        isStaticReturn = true;
      }
    }
  } else {
    handlerBodyText = text;
  }

  return {
    handlerBodyText,
    isStaticReturn,
    isSimpleExecutorCreate,
    isSimpleExecutorUpdate,
    hasConditionalLogic,
    executorName,
    executorCreateVar,
    executorCreateArgs,
    executorUpdateVar,
    isExpressionBodyCreate,
    isExpressionBodyUpdate,
    expressionBodyArgs,
    isGuardedCreate,
    guardConfig,
  };
}

function extractArgs(body: string, executorVar: string, method: string): string[] | undefined {
  const pattern = new RegExp(
    `const\\s+\\w+\\s*=\\s*await\\s+${escapeRegex(executorVar)}\\.${method}\\s*\\(`,
  );
  const match = body.match(pattern);
  if (!match) return undefined;

  const startIdx = (match.index ?? 0) + match[0].length;
  let depth = 1;
  let endIdx = startIdx;
  while (endIdx < body.length && depth > 0) {
    if (body[endIdx] === "(") depth++;
    else if (body[endIdx] === ")") depth--;
    if (depth > 0) endIdx++;
  }

  const argsStr = body.slice(startIdx, endIdx);
  return splitTopLevel(argsStr);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTopLevel(args: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function extractExprArgs(body: string, executorVar: string, method: string): string[] | undefined {
  const escaped = executorVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\.${method}\\s*\\(`);
  const match = body.match(pattern);
  if (!match) return undefined;

  const startIdx = (match.index ?? 0) + match[0].length;
  let depth = 1;
  let endIdx = startIdx;
  while (endIdx < body.length && depth > 0) {
    if (body[endIdx] === "(") depth++;
    else if (body[endIdx] === ")") depth--;
    if (depth > 0) endIdx++;
  }

  const argsStr = body.slice(startIdx, endIdx);
  return splitTopLevel(argsStr);
}

function transpileEventRefs(argsStr: string): string {
  // Transform `event.<prop>` → `ctx.event.<prop>` inside a resolver fn.
  // The original handler has `event` as a parameter; inside the pipeline
  // resolver, `event` lives on `ctx`, not as a standalone binding.
  // `ctx` references stay as-is (the resolver also receives ctx).
  return argsStr.replace(/\bevent\./g, "ctx.event.");
}

function transpileGuardRefs(body: string, varName: string): string {
  // Transform `<var>` → `ctx.steps.result` in guard body text.
  // The original handler references the executor result via
  // `result.isSuccess`, `result.error`, `result.data`, or standalone
  // `return result`. Inside the compute step, executor result lives at
  // `ctx.steps.result`. `\b` word boundary ensures we only match the
  // exact variable name.
  return body.replace(new RegExp(`\\b${escapeRegex(varName)}\\b`, "g"), "ctx.steps.result");
}

function extractGuardedPattern(
  body: string,
  varName: string,
): GuardConfig | undefined {
  const escaped = escapeRegex(varName);
  // Match: if (!<varName>.isSuccess) { return ... }
  const ifOpenPattern = new RegExp(`if\\s*\\(!${escaped}\\.isSuccess\\)\\s*\\{`);
  const ifOpenMatch = body.match(ifOpenPattern);
  if (!ifOpenMatch) return undefined;

  // Extract condition
  const condPattern = new RegExp(`if\\s*\\((!${escaped}\\.isSuccess)\\)`);
  const condMatch = body.match(condPattern);
  if (!condMatch) return undefined;
  const condition = condMatch[1]!;

  // Extract if body (between { and matching })
  const ifBodyStart = (ifOpenMatch.index ?? 0) + ifOpenMatch[0].length;
  let depth = 1;
  let ifBodyEnd = ifBodyStart;
  while (ifBodyEnd < body.length && depth > 0) {
    if (body[ifBodyEnd] === "{") depth++;
    else if (body[ifBodyEnd] === "}") depth--;
    if (depth > 0) ifBodyEnd++;
  }
  const ifBodyContent = body.slice(ifBodyStart, ifBodyEnd).trim();
  const failRetMatch = ifBodyContent.match(/return\s*([^;]+)\s*;/);
  if (!failRetMatch) return undefined;
  const failureReturn = failRetMatch[1]!.trim();

  // Extract trailing return after the if block
  const afterIf = body.slice(ifBodyEnd + 1).trim();
  const succRetMatch = afterIf.match(/return\s*([^;]+)\s*;/);
  if (!succRetMatch) return undefined;
  const successReturn = succRetMatch[1]!.trim();

  return { condition, failureReturn, successReturn };
}

export function generatePerformBlock(
  analysis: ParsedHandlerInfo,
  schemaType: string,
  indent: string,
): string | null {
  const steps: string[] = [];

  if (analysis.isStaticReturn) {
    let body = analysis.handlerBodyText.trim();
    if (body.startsWith("(") && body.endsWith(")")) {
      body = body.slice(1, -1);
    }
    steps.push(`r.step.return((ctx) => (${body}))`);
  } else if (
    analysis.isSimpleExecutorCreate &&
    analysis.executorName &&
    analysis.executorCreateArgs
  ) {
    const dataArg = analysis.executorCreateArgs[0] ?? "{}";
    steps.push(
      `r.step.aggregate.create("result", { executor: ${analysis.executorName}, data: (ctx) => ${dataArg} })`,
    );
    steps.push(`r.step.return((ctx) => ({ isSuccess: true, data: ctx.steps.result }))`);
  } else if (analysis.isSimpleExecutorUpdate && analysis.executorName) {
    steps.push(
      `r.step.aggregate.update("result", { executor: ${analysis.executorName}, id: event.payload.id, changes: event.payload.changes })`,
    );
    steps.push(`r.step.return((ctx) => ({ isSuccess: true, data: ctx.steps.result }))`);
  } else if (analysis.isExpressionBodyCreate && analysis.executorName && analysis.expressionBodyArgs) {
    const dataArg = transpileEventRefs(analysis.expressionBodyArgs[0] ?? "{}");
    steps.push(
      `r.step.aggregate.create("result", { executor: ${analysis.executorName}, data: (ctx) => ${dataArg} })`,
    );
    steps.push(`r.step.return((ctx) => ({ isSuccess: true, data: ctx.steps.result }))`);
  } else if (analysis.isExpressionBodyUpdate && analysis.executorName && analysis.expressionBodyArgs) {
    const argStr = transpileEventRefs(analysis.expressionBodyArgs[0] ?? "{}");
    steps.push(
      `r.step.compute("result", (ctx) => ${analysis.executorName}.update(${argStr}))`,
    );
    steps.push(`r.step.return((ctx) => ({ isSuccess: true, data: ctx.steps.result }))`);
  } else if (analysis.isGuardedCreate && analysis.executorName && analysis.executorCreateArgs && analysis.guardConfig) {
    const varName = analysis.executorCreateVar ?? "result";
    const dataArg = analysis.executorCreateArgs[0] ?? "{}";
    const guard = analysis.guardConfig;
    const condition = guard.condition; // already references varName
    const failureReturn = transpileGuardRefs(guard.failureReturn, varName);
    const successReturn = transpileGuardRefs(guard.successReturn, varName);
    // The condition references the original var name — transpile it too
    const condTranspiled = transpileGuardRefs(condition, varName);
    steps.push(
      `r.step.aggregate.create("result", { executor: ${analysis.executorName}, data: (ctx) => ${dataArg} })`,
    );
    steps.push(`r.step.compute("outcome", (ctx) => {
      if (${condTranspiled}) {
        return ${failureReturn};
      }
      return ${successReturn};
    })`);
    steps.push(`r.step.return((ctx) => ctx.steps.outcome)`);
  } else {
    return null;
  }

  const stepIndent = indent;
  const stepsStr = steps.map((s) => `${stepIndent}    ${s}`).join(",\n");
  const pipelineType = schemaType ? `<${schemaType}, unknown>` : "";

  return [
    `perform: pipeline${pipelineType}(({ event, r }) => [`,
    stepsStr,
    `  ${stepIndent}]),`,
  ].join("\n");
}

function inferSchemaType(objLiteral: import("ts-morph").ObjectLiteralExpression): string {
  const schemaProp = objLiteral.getProperty("schema");
  if (!schemaProp) return "unknown";
  const init = (schemaProp as import("ts-morph").PropertyAssignment).getInitializer();
  if (!init) return "unknown";
  const text = init.getText();
  // Only return simple names (like `InvoiceSchema`), not inline definitions
  if (/^[A-Za-z_$][\w$.]*$/.test(text)) {
    return `typeof ${text}`;
  }
  return ""; // Empty = omit type params
}

function findFiles(rootDir: string): string[] {
  const glob = new Glob("**/*.write.ts");
  const files: string[] = [];
  for (const file of glob.scanSync(rootDir)) {
    files.push(join(rootDir, file));
  }
  return files.sort();
}

export function scanForCandidates(rootDir: string): FileAnalysis[] {
  const files = findFiles(rootDir);
  const results: FileAnalysis[] = [];

  for (const file of files) {
    const analysis = analyzeFile(file);
    if (analysis) results.push(analysis);
  }

  return results;
}

export type FileAnalysis = {
  readonly filePath: string;
  readonly pattern: "free-form-write" | "pipeline-write" | "query-handler" | "other";
  readonly convertible: boolean;
  readonly reason: string;
  readonly handlerLine?: number;
};

export function analyzeFile(filePath: string): FileAnalysis | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.includes("defineWriteHandler") && !content.includes("defineQueryHandler")) {
      return null;
    }

    if (content.includes("defineWriteHandler") && content.includes("perform:")) {
      return {
        filePath,
        pattern: "pipeline-write",
        convertible: false,
        reason: "already uses pipeline form",
      };
    }

    if (content.includes("defineWriteHandler")) {
      return {
        filePath,
        pattern: "free-form-write",
        convertible: true,
        reason: "free-form write handler",
      };
    }

    if (content.includes("defineQueryHandler")) {
      return {
        filePath,
        pattern: "query-handler",
        convertible: false,
        reason: "query handlers not convertible",
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function runCodemod(
  rootDir: string,
  options: CodemodOptions = {},
): Promise<CodemodReport> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  const candidates = scanForCandidates(rootDir);
  const writeHandlers = candidates.filter((c) => c.pattern === "free-form-write");

  console.log(`\n  Scanning ${rootDir}...`);
  console.log(`  Found ${writeHandlers.length} file(s) with free-form write handlers.\n`);

  if (writeHandlers.length === 0) {
    return { results: [], converted: 0, skipped: 0, errors: 0 };
  }

  const results: CodemodResult[] = [];

  for (const candidate of writeHandlers) {
    const result = await convertFile(candidate.filePath, project, options);
    results.push(result);
  }

  const converted = results.filter((r) => r.status === "converted").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log(`\n  Results: ${converted} converted, ${skipped} skipped, ${errors} errors\n`);

  if (options.verbose) {
    for (const r of results) {
      if (r.status === "error") {
        console.log(`  ✗ ${relative(process.cwd(), r.filePath)}: ${r.reason}`);
      } else if (r.status === "converted") {
        console.log(`  ✓ ${relative(process.cwd(), r.filePath)}`);
      } else {
        console.log(`  - ${relative(process.cwd(), r.filePath)}: ${r.reason}`);
      }
    }
  }

  return { results, converted, skipped, errors };
}

function contentHasPipelineImport(content: string): boolean {
  // Check the actual import line, not later usage of the word `pipeline`
  // in the perform block. Single-line import matching only (standard
  // formatting in this codebase — never multi-line).
  const importLine = content
    .split("\n")
    .find((l) => l.includes("import") && l.includes("@cosmicdrift/kumiko-framework/engine"));
  return !!importLine && importLine.includes("pipeline");
}

function ensurePipelineImport(content: string): string | null {
  if (contentHasPipelineImport(content)) return null;
  // Single-line regex is safe — imports in this codebase are always
  // `import { ... } from "@cosmicdrift/kumiko-framework/engine"`.
  const importRegex =
    /import\s*\{([^}]*)\}\s*from\s*["']@cosmicdrift\/kumiko-framework\/engine["']/;
  const match = content.match(importRegex);
  if (match) {
    const existingImports = (match[1] as string).trim();
    const newImports = existingImports ? `${existingImports}, pipeline` : "pipeline";
    return content.replace(
      importRegex,
      `import { ${newImports} } from "@cosmicdrift/kumiko-framework/engine"`,
    );
  }

  return null;
}

export async function convertFile(
  filePath: string,
  project?: Project,
  options: CodemodOptions = {},
): Promise<CodemodResult> {
  try {
    const contentBefore = readFileSync(filePath, "utf8");
    const proj =
      project ??
      new Project({
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
      });
    const sourceFile = proj.addSourceFileAtPath(filePath);

    const handlerCalls = findDefineWriteHandlerCalls(sourceFile);
    if (handlerCalls.length === 0) {
      return { filePath, status: "skipped", reason: "no defineWriteHandler calls" };
    }

    let content = contentBefore;
    let hadChanges = false;

    for (const call of handlerCalls) {
      const arg = call.getArguments()[0];
      if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) {
        continue;
      }

      const objLiteral = arg.asKind(SyntaxKind.ObjectLiteralExpression);
      if (!objLiteral) continue;

      const handlerProp = objLiteral.getProperty("handler");
      if (!handlerProp) continue;

      const propAssign = handlerProp.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;

      const handlerInit = propAssign.getInitializer();
      if (!handlerInit) continue;

      const analysis = analyzeHandlerArrow(handlerInit.getText());
      if (
        !analysis.isStaticReturn &&
        !analysis.isSimpleExecutorCreate &&
        !analysis.isSimpleExecutorUpdate &&
        !analysis.isExpressionBodyCreate &&
        !analysis.isExpressionBodyUpdate &&
        !analysis.isGuardedCreate
      ) {
        if (options.verbose) {
          console.log(`  ~ ${relative(process.cwd(), filePath)}: non-trivial handler, skipping`);
        }
        continue;
      }

      const schemaType = inferSchemaType(objLiteral);
      const indent = propAssign.getIndentationText() ?? "    ";
      const performBlock = generatePerformBlock(analysis, schemaType, indent);
      if (!performBlock) continue;

      const start = propAssign.getStart();
      let end = propAssign.getEnd();
      // Consume trailing comma after the property assignment
      if (end < content.length && content[end] === ",") {
        end++;
      }
      content = content.slice(0, start) + performBlock + content.slice(end);
      hadChanges = true;
    }

    if (hadChanges) {
      const importResult = ensurePipelineImport(content);
      if (importResult) {
        content = importResult;
      } else if (options.verbose) {
        console.log(`  ~ ${filePath}: pipeline import not needed or already present`);
      }
    }

    if (hadChanges && !options.dryRun) {
      writeFileSync(filePath, content, "utf8");
    }

    const status = hadChanges ? "converted" : "skipped";
    const reason = hadChanges
      ? "handler replaced with perform: pipeline(...)"
      : "no convertible handler";
    return { filePath, status, reason };
  } catch (err) {
    return {
      filePath,
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function findDefineWriteHandlerCalls(sourceFile: SourceFile): CallExpression[] {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const expr = call.getExpression();
    return expr.getText() === "defineWriteHandler";
  });
}
