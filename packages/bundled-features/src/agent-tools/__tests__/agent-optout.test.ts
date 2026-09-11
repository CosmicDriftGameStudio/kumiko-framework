import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { authFoundationFeature } from "../../auth-foundation";
import { AuthMfaHandlers, AuthMfaQueries, createAuthMfaFeature } from "../../auth-mfa";
import { createConfigFeature } from "../../config";
import { createCryptoShreddingFeature } from "../../crypto-shredding";
import { createPersonalAccessTokensFeature, PatHandlers } from "../../personal-access-tokens";
import { createSecretsFeature } from "../../secrets";
import { createTenantFeature } from "../../tenant";
import { createUserFeature } from "../../user/feature";
import { buildAgentManifest } from "../agent-manifest";
import { buildToolCatalog, toolNameForQn } from "../tool-catalog";

// #2700/#2702 — bundled handlers that carry secrets/irreversible-erase risk are now
// opted out of the agent tool catalog via `agent: { expose: false }`, and the app-side
// `denyQns` cut removes a handler the catalog would otherwise expose (including the
// entity-CRUD tools, which bypass the manifest entirely).

const SECRETS_HANDLING_FEATURE_QNS = [
  AuthMfaHandlers.enableStart,
  AuthMfaHandlers.enableStartPreauth,
  AuthMfaHandlers.regenerateRecovery,
  PatHandlers.create,
  "crypto-shredding:write:forget-subject",
  "secrets:write:set",
] as const;

// enable-start-preauth is gated to the literal role "all" (login-flow guest caller,
// see auth-mfa/handlers/enable-start-preauth.write.ts) — none of the three roles
// exercised below carry that role, so hasAccess alone would already exclude it and
// this one QN's absence doesn't prove agent.expose:false is doing the work. The other
// five QNs are openToAll or role-reachable by at least one of ["User"], ["TenantAdmin"],
// ["SystemAdmin"], so their absence does.
function buildSecretHandlingFeatures() {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    authFoundationFeature,
    createAuthMfaFeature({
      setupTokenSecret: "test-mfa-setup-secret-at-least-32-bytes!!",
      issuer: "Kumiko Test",
      challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
    }),
    createPersonalAccessTokensFeature({ scopes: {} }),
    createCryptoShreddingFeature(),
    createSecretsFeature(),
  ];
}

describe("bundled secret-bearing handlers are not in the catalog", () => {
  const roleCases: ReadonlyArray<readonly string[]> = [["User"], ["TenantAdmin"], ["SystemAdmin"]];

  for (const roles of roleCases) {
    test(`roles ${JSON.stringify(roles)}: none of the opted-out handlers reach the catalog or manifest`, () => {
      const registry = createRegistry(buildSecretHandlingFeatures());
      const manifest = buildAgentManifest(registry, { locale: "en", roles });
      const catalog = buildToolCatalog(registry, manifest, { mode: "edit" });
      const toolNames = catalog.tools.map((t) => t.name);
      const manifestQns = manifest.handlers.map((h) => h.qn);

      for (const qn of SECRETS_HANDLING_FEATURE_QNS) {
        const toolName = toolNameForQn(qn);
        expect(toolNames).not.toContain(toolName);
        expect(catalog.dispatchTable.has(toolName)).toBe(false);
        expect(manifestQns).not.toContain(qn);
      }

      // Positive control: a still-exposed bundled handler ("is MFA enabled for me?")
      // must survive — without this, the six assertions above would also pass for a
      // registry that mounted no features at all.
      const statusToolName = toolNameForQn(AuthMfaQueries.status);
      expect(toolNames).toContain(statusToolName);
      expect(catalog.dispatchTable.has(statusToolName)).toBe(true);
      expect(manifestQns).toContain(AuthMfaQueries.status);
    });
  }
});

function buildDenyTestFeature() {
  return defineFeature("deny-test", (r) => {
    r.queryHandler("alpha", z.object({}), async () => ({ ok: true }), {
      access: { roles: ["Admin"] },
      description: "Alpha query handler.",
    });
    r.queryHandler("beta", z.object({}), async () => ({ ok: true }), {
      access: { roles: ["Admin"] },
      description: "Beta query handler.",
    });
  });
}

const DENY_TEST_QN_A = "deny-test:query:alpha";
const DENY_TEST_QN_B = "deny-test:query:beta";

describe("denyQns removes a tool", () => {
  function buildDenyCatalog(denyQns?: readonly string[]) {
    const registry = createRegistry([buildDenyTestFeature()]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["Admin"], denyQns });
    const catalog = buildToolCatalog(registry, manifest, { mode: "edit", denyQns });
    return { manifest, catalog };
  }

  test("without denyQns both handler-derived tools are present", () => {
    const { catalog } = buildDenyCatalog();
    const names = catalog.tools.map((t) => t.name);
    expect(names).toContain(toolNameForQn(DENY_TEST_QN_A));
    expect(names).toContain(toolNameForQn(DENY_TEST_QN_B));
  });

  test("denyQns on both buildAgentManifest and buildToolCatalog removes only the denied tool", () => {
    const { manifest, catalog } = buildDenyCatalog([DENY_TEST_QN_A]);
    const nameA = toolNameForQn(DENY_TEST_QN_A);
    const nameB = toolNameForQn(DENY_TEST_QN_B);

    expect(catalog.tools.map((t) => t.name)).not.toContain(nameA);
    expect(catalog.dispatchTable.has(nameA)).toBe(false);
    expect(manifest.handlers.map((h) => h.qn)).not.toContain(DENY_TEST_QN_A);

    expect(catalog.tools.map((t) => t.name)).toContain(nameB);
    expect(catalog.dispatchTable.has(nameB)).toBe(true);
    expect(manifest.handlers.map((h) => h.qn)).toContain(DENY_TEST_QN_B);
  });

  test("denyQns passed only to buildToolCatalog still removes the tool, even though the manifest still lists the handler", () => {
    const registry = createRegistry([buildDenyTestFeature()]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["Admin"] });
    expect(manifest.handlers.map((h) => h.qn)).toContain(DENY_TEST_QN_A);

    const catalog = buildToolCatalog(registry, manifest, {
      mode: "edit",
      denyQns: [DENY_TEST_QN_A],
    });
    const nameA = toolNameForQn(DENY_TEST_QN_A);
    expect(catalog.tools.map((t) => t.name)).not.toContain(nameA);
    expect(catalog.dispatchTable.has(nameA)).toBe(false);
  });
});

const gadgetEntity = createEntity({
  fields: {
    name: createTextField({
      searchable: true,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

function buildGadgetCrudFeature() {
  return defineFeature("gadget-crud-test", (r) => {
    r.crud("gadget", gadgetEntity, {
      read: { access: { roles: ["Admin"] } },
      write: { access: { roles: ["Admin"] } },
    });
  });
}

const GADGET_LIST_QN = "gadget-crud-test:query:gadget:list";
const GADGET_DETAIL_QN = "gadget-crud-test:query:gadget:detail";

describe("denyQns reaches the entity CRUD tools", () => {
  function buildGadgetCatalog(denyQns?: readonly string[]) {
    const registry = createRegistry([buildGadgetCrudFeature()]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["Admin"], denyQns });
    return buildToolCatalog(registry, manifest, { mode: "edit", denyQns });
  }

  test("without denyQns the full entity CRUD tool set is present", () => {
    const names = buildGadgetCatalog().tools.map((t) => t.name);
    expect(names).toContain("get_gadget");
    expect(names).toContain("list_gadget");
    expect(names).toContain("search_gadget");
    expect(names).toContain("find_gadget_by_name");
  });

  test("denying the :list QN removes list/search/find-by but keeps get", () => {
    const names = buildGadgetCatalog([GADGET_LIST_QN]).tools.map((t) => t.name);
    expect(names).not.toContain("list_gadget");
    expect(names).not.toContain("search_gadget");
    expect(names).not.toContain("find_gadget_by_name");
    expect(names).toContain("get_gadget");
  });

  test("denying the :detail QN removes get_gadget", () => {
    const names = buildGadgetCatalog([GADGET_DETAIL_QN]).tools.map((t) => t.name);
    expect(names).not.toContain("get_gadget");
  });
});

const plainItemEntity = createEntity({
  fields: {
    label: createTextField({
      searchable: true,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
  },
});
const cloakedItemEntity = createEntity({
  fields: {
    label: createTextField({
      searchable: true,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

// Both entities mounted in the same feature so the "default stays exposed"
// assertion and the "explicit opt-out hides it" assertion run against one
// shared registry/catalog build and prove each other's premise.
function buildExposureTestFeature() {
  return defineFeature("expose-test", (r) => {
    r.crud("plain-item", plainItemEntity, {
      read: { access: { roles: ["Admin"] } },
      write: { access: { roles: ["Admin"] } },
    });

    r.entity("cloaked-item", cloakedItemEntity);
    r.queryHandler(
      defineEntityListHandler("cloaked-item", cloakedItemEntity, {
        access: { roles: ["Admin"] },
        agent: { expose: false },
      }),
    );
    r.queryHandler(
      defineEntityDetailHandler("cloaked-item", cloakedItemEntity, {
        access: { roles: ["Admin"] },
      }),
    );
  });
}

describe("#2700 — explicit agent.expose:false on an entity handler, both directions", () => {
  function buildExposureCatalog() {
    const registry = createRegistry([buildExposureTestFeature()]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["Admin"] });
    return buildToolCatalog(registry, manifest, { mode: "edit" });
  }

  test("a CRUD entity without any agent hint keeps its default entity tools — resolveAgentExposure never runs on it", () => {
    const names = buildExposureCatalog().tools.map((t) => t.name);
    // CRUD-generated list/detail handlers carry no `description`, and
    // resolveAgentExposure is fail-closed on a missing description — applying it here
    // would delete every entity tool in every app, not just an opted-out one.
    expect(names).toContain("get_plain-item");
    expect(names).toContain("list_plain-item");
    expect(names).toContain("search_plain-item");
    expect(names).toContain("find_plain-item_by_label");
  });

  test("an entity's list handler with an explicit agent.expose:false loses list/search/find-by but keeps get", () => {
    const names = buildExposureCatalog().tools.map((t) => t.name);
    expect(names).not.toContain("list_cloaked-item");
    expect(names).not.toContain("search_cloaked-item");
    expect(names).not.toContain("find_cloaked-item_by_label");
    expect(names).toContain("get_cloaked-item");
  });
});
