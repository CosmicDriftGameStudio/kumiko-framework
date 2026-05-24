// Integration-Test: alle Sprint-0-Surfaces in einem Mini-Feature-Set.
//
// Beweist dass die einzelnen S0-Komponenten (PII-Annotations, retention,
// extension-names, exposesApi/usesApi, ROLES) zusammen funktionieren —
// keine still-konkurrierenden Validierungen, keine Race-Conditions
// zwischen Sub-Validatoren.
//
// Mini-Feature-Set:
//   compliance-profiles  exposesApi("compliance.forTenant")
//   user-data-rights     usesApi + extendsRegistrar(EXT_USER_DATA)
//   tenant               useExtension(EXT_USER_DATA, "user", ...)
//                        + entity mit pii / userOwned / tenantOwned-Fields
//                        + retention.blockDelete + anonymize-Funktion
//                        + handler-access mit ROLES.TenantAdmin

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { ROLES } from "../../auth";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import {
  createEntity,
  createLongTextField,
  createTextField,
  createTimestampField,
  EXT_USER_DATA,
} from "../index";

describe("S0 Integration — full surface stack", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("alle S0-Surfaces zusammen passen Boot-Validation", () => {
    const complianceProfiles = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
      r.queryHandler({
        name: "compliance:query:for-tenant",
        schema: z.object({}),
        handler: async () => ({ profile: "eu-dsgvo" }) as never,
        access: { openToAll: true },
      });
    });

    const userDataRights = defineFeature("user-data-rights", (r) => {
      r.requires("compliance-profiles");
      r.usesApi("compliance.forTenant");
      r.extendsRegistrar(EXT_USER_DATA, {
        hooks: {},
      });
    });

    const tenantFeature = defineFeature("tenant-app", (r) => {
      r.requires("user-data-rights", "compliance-profiles");

      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({ pii: true }),
            displayName: createTextField({ pii: true }),
            lastLoginAt: createTimestampField({ pii: true }),
          },
          retention: {
            keepFor: "10y",
            strategy: "blockDelete",
            reference: "createdAt",
          },
        }),
      );

      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({
              userOwned: { ownerField: "authorId" },
              anonymize: () => "[ANONYMIZED]",
            }),
            authorId: { type: "reference", entity: "user" },
          },
        }),
      );

      r.queryHandler({
        name: "user:list",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }) as never,
        access: { openToAll: true },
      });

      r.useExtension(EXT_USER_DATA, "user", {});
      r.useExtension(EXT_USER_DATA, "comment", {});

      r.writeHandler({
        name: "user:rename",
        schema: z.object({ id: z.string(), displayName: z.string() }),
        handler: async () => undefined as never,
        access: { roles: [ROLES.TenantAdmin] },
      });
    });

    expect(() => validateBoot([complianceProfiles, userDataRights, tenantFeature])).not.toThrow();
  });

  test("missing requires() on usesApi-target throws even when other surfaces are clean", () => {
    const complianceProfiles = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });

    const userDataRights = defineFeature("user-data-rights", (r) => {
      // VERGESSEN: r.requires("compliance-profiles")
      r.usesApi("compliance.forTenant");
    });

    expect(() => validateBoot([complianceProfiles, userDataRights])).toThrow(
      /not in requires\/optionalRequires\. Add r\.requires\("compliance-profiles"\)/,
    );
  });

  test("retention.reference pointing to non-existent field throws even with valid PII annotations", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({ pii: true }),
          },
          retention: {
            keepFor: "30d",
            strategy: "hardDelete",
            reference: "notARealField",
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(
      /retention\.reference "notARealField" does not exist/,
    );
  });

  test("ROLES.TenantAdmin works as handler-access role string (no Admin/TenantAdmin drift)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ fields: { ts: createTimestampField() } }));
      r.writeHandler({
        name: "thing:create",
        schema: z.object({}),
        handler: async () => undefined as never,
        access: { roles: [ROLES.TenantAdmin] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
