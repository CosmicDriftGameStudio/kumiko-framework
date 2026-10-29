export type BootViolation = {
  readonly ruleId: string;
  readonly check: string;
  readonly feature?: string;
  readonly message: string;
  readonly fix?: string;
};

export type BootRule = {
  readonly id: string;
  readonly summary: string;
  readonly fix: string;
};

export type BootRuleTable = Readonly<Record<string, BootRule>>;

export class BootRuleViolation extends Error {
  override readonly name = "BootRuleViolation";

  constructor(
    readonly rule: BootRule,
    message: string,
  ) {
    super(message);
  }
}

export function bootRuleError(
  rule: BootRule,
  details: { readonly message: string },
): BootRuleViolation {
  return new BootRuleViolation(rule, details.message);
}

export class BootRuleFailures extends Error {
  override readonly name = "BootRuleFailures";

  constructor(readonly failures: readonly Error[]) {
    super(failures.map((failure) => failure.message).join("\n"));
  }
}

const UNCLASSIFIED_RULE_PREFIX = "unclassified/";

// Must match anchorOf in packages/guards/src/_lib/agent-docs-boot-rules.ts.
export function bootRuleDocLink(ruleId: string): string | undefined {
  if (ruleId.startsWith(UNCLASSIFIED_RULE_PREFIX)) return undefined;
  return `agents/boot-rules.md#${ruleId.replaceAll("/", "-")}`;
}

function describeViolation(violation: BootViolation): string {
  const lines = [`- [${violation.ruleId}] ${violation.message}`];
  if (violation.fix !== undefined) lines.push(`  Fix: ${violation.fix}`);
  const docLink = bootRuleDocLink(violation.ruleId);
  if (docLink !== undefined) lines.push(`  Rule: ${docLink}`);
  return lines.join("\n");
}

export class BootValidationError extends Error {
  override readonly name = "BootValidationError";

  constructor(readonly violations: readonly BootViolation[]) {
    const count = violations.length;
    const header = `Boot validation failed: ${count} violation${count === 1 ? "" : "s"}`;
    super([header, ...violations.map(describeViolation)].join("\n"));
  }
}
