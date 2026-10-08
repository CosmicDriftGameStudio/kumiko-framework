import { describe, expect, test } from "bun:test";
import {
  type AgentRisk,
  type FeatureDefinition,
  resolveAgentExposure,
} from "@cosmicdrift/kumiko-framework/engine";
import { createAuthMfaFeature } from "../../auth-mfa/index.js";
import { createCryptoShreddingFeature } from "../../crypto-shredding/index.js";
import { createLedgerFeature } from "../../ledger/index.js";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/index.js";
import { createSecretsFeature } from "../../secrets/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createTierEngineFeature } from "../../tier-engine/index.js";
import { createUserFeature } from "../../user/index.js";
import { createUserDataRightsFeature } from "../../user-data-rights/index.js";

// Pins the agent-exposure decision of security-relevant bundled handlers: dropping
// `agent: { expose: false }` from a token/secret flow or `risk: "high"` from a
// PII-reading or irreversible handler must turn a test red, not silently widen what
// an agent may run without approval.

type ExposureCase = {
  readonly feature: FeatureDefinition;
  readonly kind: "write" | "query";
  readonly handlerName: string;
  readonly expose: boolean;
  readonly risk?: AgentRisk;
};

const mfa = createAuthMfaFeature({
  setupTokenSecret: "test-mfa-setup-secret-at-least-32-bytes!!",
  issuer: "Kumiko Test",
  challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
});
const tenant = createTenantFeature();
const sessions = createSessionsFeature();
const userDataRights = createUserDataRightsFeature();
const pat = createPersonalAccessTokensFeature({ scopes: {} });
const secrets = createSecretsFeature();
const cryptoShredding = createCryptoShreddingFeature();

const CASES: readonly ExposureCase[] = [
  { feature: tenant, kind: "query", handlerName: "members", expose: true, risk: "high" },
  { feature: tenant, kind: "query", handlerName: "invitations", expose: true, risk: "high" },
  {
    feature: sessions,
    kind: "query",
    handlerName: "user-session:detail",
    expose: true,
    risk: "high",
  },
  {
    feature: userDataRights,
    kind: "query",
    handlerName: "list-download-attempts",
    expose: true,
    risk: "high",
  },
  {
    feature: userDataRights,
    kind: "write",
    handlerName: "request-deletion-by-email",
    expose: true,
    risk: "high",
  },
  { feature: mfa, kind: "write", handlerName: "enable-confirm", expose: true, risk: "high" },
  { feature: tenant, kind: "write", handlerName: "disable", expose: true, risk: "high" },
  { feature: tenant, kind: "write", handlerName: "enable", expose: true, risk: "mid" },
  { feature: tenant, kind: "write", handlerName: "updateMemberRoles", expose: true, risk: "high" },
  {
    feature: createUserFeature(),
    kind: "write",
    handlerName: "user:update",
    expose: true,
    risk: "high",
  },
  {
    feature: createTierEngineFeature(),
    kind: "write",
    handlerName: "set-tenant-tier",
    expose: true,
    risk: "high",
  },
  {
    feature: createLedgerFeature(),
    kind: "write",
    handlerName: "create-transaction",
    expose: true,
    risk: "high",
  },
  {
    feature: createLedgerFeature(),
    kind: "write",
    handlerName: "reverse-transaction",
    expose: true,
    risk: "high",
  },
  { feature: userDataRights, kind: "write", handlerName: "run-forget-cleanup", expose: false },
  { feature: cryptoShredding, kind: "write", handlerName: "forget-subject", expose: false },
  { feature: mfa, kind: "write", handlerName: "enable-start", expose: false },
  { feature: mfa, kind: "write", handlerName: "enable-confirm-preauth", expose: false },
  { feature: mfa, kind: "write", handlerName: "regenerate-recovery", expose: false },
  { feature: pat, kind: "write", handlerName: "create", expose: false },
  { feature: secrets, kind: "write", handlerName: "set", expose: false },
];

describe("bundled handlers keep their agent exposure and risk", () => {
  for (const { feature, kind, handlerName, expose, risk } of CASES) {
    test(`${feature.name}:${kind}:${handlerName} -> expose ${expose}${risk ? `, risk ${risk}` : ""}`, () => {
      const handlers = kind === "write" ? feature.writeHandlers : feature.queryHandlers;
      const def = handlers[handlerName];
      if (def === undefined) {
        throw new Error(`${feature.name} has no ${kind} handler "${handlerName}"`);
      }
      const resolved = resolveAgentExposure(def, kind);
      expect(resolved.expose).toBe(expose);
      if (risk !== undefined) expect(resolved.risk).toBe(risk);
    });
  }
});
