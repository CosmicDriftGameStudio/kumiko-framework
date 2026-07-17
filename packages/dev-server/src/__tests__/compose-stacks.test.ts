import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import {
  composeFileStack,
  composeGdprStack,
  composeMailStack,
  composeOpsStack,
  composePagesStack,
  composeRendererStack,
  composeUserDataRightsStack,
  stackFeatureNames,
} from "../compose-stacks";

describe("composeStacks", () => {
  test("composeRendererStack → template-resolver, renderer-foundation, renderer-simple", () => {
    expect(stackFeatureNames(composeRendererStack())).toEqual([
      "template-resolver",
      "renderer-foundation",
      "renderer-simple",
    ]);
  });

  test("composePagesStack → text-content + legal-pages", () => {
    expect(stackFeatureNames(composePagesStack())).toEqual(["text-content", "legal-pages"]);
  });

  test("composeMailStack mounts foundation + selected transports", () => {
    expect(stackFeatureNames(composeMailStack({ transports: ["inmemory", "smtp"] }))).toEqual([
      "mail-foundation",
      "mail-transport-inmemory",
      "mail-transport-smtp",
    ]);
  });

  test("composeFileStack mounts foundation + providers + files entity", () => {
    expect(stackFeatureNames(composeFileStack({ providers: ["inmemory", "s3"] }))).toEqual([
      "file-foundation",
      "file-provider-inmemory",
      "file-provider-s3",
      "files",
    ]);
  });

  test("composeGdprStack retention-first (money-horse / publicstatus pattern)", () => {
    expect(stackFeatureNames(composeGdprStack({ tenantLifecycle: true, sessions: true }))).toEqual([
      "data-retention",
      "compliance-profiles",
      "tenant-lifecycle",
      "sessions",
    ]);
  });

  test("composeGdprStack compliance-first (studio pattern)", () => {
    expect(stackFeatureNames(composeGdprStack({ order: "compliance-first" }))).toEqual([
      "compliance-profiles",
      "data-retention",
    ]);
  });

  test("composeUserDataRightsStack → udr + defaults", () => {
    expect(stackFeatureNames(composeUserDataRightsStack())).toEqual([
      "user-data-rights",
      "user-data-rights-defaults",
    ]);
  });

  test("composeOpsStack defaults delivery + audit + jobs", () => {
    expect(stackFeatureNames(composeOpsStack())).toEqual(["delivery", "audit", "jobs"]);
  });

  test("composeOpsStack rateLimiting opt-in", () => {
    expect(stackFeatureNames(composeOpsStack({ rateLimiting: true }))).toEqual([
      "delivery",
      "audit",
      "jobs",
      "rate-limiting",
    ]);
  });
});

/** Snapshot, not a live parity check: intended block combinations, mirrored by hand from studio/money-horse/publicstatus run-configs. A drifted run-config stays green here. */
describe("composeStacks boots for real", () => {
  test("studio-shaped combined stack passes validateBoot (not just name-list comparison)", () => {
    const features = composeFeatures(
      [
        ...composeOpsStack({ rateLimiting: true }),
        ...composePagesStack(),
        ...composeMailStack({ transports: ["inmemory"] }),
        ...composeFileStack({ providers: ["inmemory"] }),
        ...composeGdprStack({ order: "compliance-first", sessions: true }),
        ...composeUserDataRightsStack(),
      ],
      { includeBundled: true },
    );
    expect(() => validateBoot(features)).not.toThrow();
  });
});

describe("composeStacks intended block names (snapshot, not live parity)", () => {
  test("studio SaaS blocks are covered by presets", () => {
    const names = stackFeatureNames([
      ...composeOpsStack({ rateLimiting: true }),
      ...composePagesStack(),
      ...composeMailStack({ transports: ["inmemory", "smtp"] }),
      ...composeFileStack({ providers: ["inmemory", "s3"] }),
      ...composeGdprStack({ order: "compliance-first" }),
      ...composeUserDataRightsStack(),
    ]);
    for (const expected of [
      "delivery",
      "audit",
      "jobs",
      "rate-limiting",
      "text-content",
      "legal-pages",
      "mail-foundation",
      "file-foundation",
      "files",
      "compliance-profiles",
      "data-retention",
      "user-data-rights",
      "user-data-rights-defaults",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("money-horse GDPR + file block names", () => {
    const names = stackFeatureNames([
      ...composePagesStack(),
      ...composeRendererStack(),
      ...composeOpsStack({ delivery: true, audit: false, jobs: false }),
      ...composeGdprStack({ sessions: true }),
      ...composeFileStack({ providers: ["s3-env"] }),
      ...composeUserDataRightsStack(),
    ]);
    for (const expected of [
      "text-content",
      "legal-pages",
      "data-retention",
      "compliance-profiles",
      "sessions",
      "file-foundation",
      "file-provider-s3-env",
      "files",
      "user-data-rights",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("publicstatus core stack block names", () => {
    const names = stackFeatureNames([
      ...composePagesStack(),
      ...composeGdprStack({ tenantLifecycle: true }),
      ...composeOpsStack({ delivery: true, audit: true, jobs: true }),
      ...composeRendererStack(),
      ...composeFileStack({ providers: ["inmemory"] }),
      ...composeUserDataRightsStack(),
    ]);
    for (const expected of [
      "text-content",
      "legal-pages",
      "tenant-lifecycle",
      "audit",
      "delivery",
      "jobs",
      "renderer-simple",
      "files",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
