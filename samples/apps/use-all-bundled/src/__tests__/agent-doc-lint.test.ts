// Guards the conditional half of the registry against #2643: auth-email-password
// registers reset/verify/unlock only when the matching option object is passed,
// and file-derivatives registers `public-variant` only with resolveApexTenant.
// Drop one of those options from run-config.ts and `kumiko agent lint` keeps
// reporting zero gaps — not because the handlers are documented, but because it
// never sees them. These tests fail instead.

import { describe, expect, test } from "bun:test";
import { findAgentDocGaps } from "@cosmicdrift/kumiko-bundled-features/agent-tools";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import config from "../../kumiko.config";

const CONDITIONAL_HANDLER_QNS = [
  "auth-email-password:write:confirm-account-unlock",
  "auth-email-password:write:request-account-unlock",
  "auth-email-password:write:request-email-verification",
  "auth-email-password:write:request-password-reset",
  "auth-email-password:write:reset-password",
  "auth-email-password:write:verify-email",
  "file-derivatives:query:public-variant",
] as const;

const CONDITIONAL_HANDLERS: Readonly<
  Record<string, { readonly write: readonly string[]; readonly query: readonly string[] }>
> = {
  "auth-email-password": {
    write: [
      "request-password-reset",
      "reset-password",
      "request-email-verification",
      "verify-email",
      "request-account-unlock",
      "confirm-account-unlock",
    ],
    query: [],
  },
  "file-derivatives": { write: [], query: ["public-variant"] },
};

type AgentDocFields = {
  readonly description?: string;
  readonly agent?: { readonly expose?: boolean };
};

function withoutAgentDocs<T extends AgentDocFields>(def: T): Omit<T, "description" | "agent"> {
  const { description: _description, agent: _agent, ...rest } = def;
  return rest;
}

function stripAgentDocs<T extends AgentDocFields>(
  defs: Readonly<Record<string, T>> | undefined,
  names: readonly string[],
): Record<string, T> {
  const stripped: Record<string, T> = { ...defs };
  for (const name of names) {
    const def = stripped[name];
    if (def === undefined) continue;
    stripped[name] = withoutAgentDocs(def);
  }
  return stripped;
}

function undocumentConditionalHandlers(
  features: readonly FeatureDefinition[],
): FeatureDefinition[] {
  return features.map((feature) => {
    const targets = CONDITIONAL_HANDLERS[feature.name];
    if (targets === undefined) return feature;
    return {
      ...feature,
      writeHandlers: stripAgentDocs(feature.writeHandlers, targets.write),
      queryHandlers: stripAgentDocs(feature.queryHandlers, targets.query),
    };
  });
}

describe("use-all-bundled agent-doc coverage", () => {
  test("the linted feature list is what `kumiko agent lint` reports clean", () => {
    expect(findAgentDocGaps(config.features)).toEqual([]);
  });

  test("every conditionally registered handler is inside the linted set", () => {
    const gaps = findAgentDocGaps(undocumentConditionalHandlers(config.features));

    expect([...gaps].map((gap) => gap.qn).sort()).toEqual([...CONDITIONAL_HANDLER_QNS].sort());
  });
});
