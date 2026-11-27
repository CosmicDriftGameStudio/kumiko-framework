import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSecurityBaselineStackSource } from "../scripts/codemod/security-baseline-stack.ts";

const STUDIO_RUN_CONFIG = `import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";

export const APP_FEATURES = [
  createSecretsFeature(),
  createAuthFoundationFeature(),
  createSessionsFeature(),
  createDeliveryFeature(),
  localeDe(),
] as const;

export const HAS_AUTH = true;
`;

const MAIN_WITH_KMS = `const kmsWiring = resolveKmsWiring(process.env);\nawait runProdApp({ features: APP_FEATURES, ...kmsWiring });\n`;
const MAIN_WITHOUT_KMS = `await runProdApp({ features: APP_FEATURES });\n`;

let root = "";
let runConfig = "";

function writeMain(content: string): void {
  writeFileSync(join(root, "bin", "main.ts"), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "security-baseline-stack-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "bin"));
  runConfig = join(root, "src", "run-config.ts");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("security-baseline-stack codemod", () => {
  it("mounts composeSecurityStack right after createSessionsFeature in the studio skeleton", () => {
    writeMain(MAIN_WITH_KMS);
    const result = transformSecurityBaselineStackSource(STUDIO_RUN_CONFIG, runConfig);
    expect(result.rewrites).toHaveLength(1);
    expect(result.manual).toHaveLength(0);
    expect(result.output).toContain(
      `import { composeSecurityStack } from "@cosmicdrift/kumiko-dev-server/compose-stacks";`,
    );
    expect(result.output).toMatch(
      /createSessionsFeature\(\), \.\.\.composeSecurityStack\(\{ includeSessions: false \}\),\s+createDeliveryFeature\(\)/,
    );
  });

  it("is idempotent on a second run", () => {
    writeMain(MAIN_WITH_KMS);
    const first = transformSecurityBaselineStackSource(STUDIO_RUN_CONFIG, runConfig);
    const second = transformSecurityBaselineStackSource(first.output, runConfig);
    expect(second.output).toBe(first.output);
    expect(second.rewrites).toHaveLength(0);
    expect(second.manual).toHaveLength(0);
  });

  it("leaves an app that already mounts composeSecurityStack or one of its features", () => {
    writeMain(MAIN_WITH_KMS);
    const withStack = STUDIO_RUN_CONFIG.replace(
      "createSessionsFeature(),",
      "createSessionsFeature(),\n  ...composeSecurityStack({ includeSessions: false }),",
    );
    const withAudit = STUDIO_RUN_CONFIG.replace(
      "localeDe(),",
      "localeDe(),\n  createAuditFeature(),",
    );
    for (const input of [withStack, withAudit]) {
      const result = transformSecurityBaselineStackSource(input, runConfig);
      expect(result.output).toBe(input);
      expect(result.rewrites).toHaveLength(0);
      expect(result.manual).toHaveLength(0);
    }
  });

  it("leaves an app without sessions", () => {
    writeMain(MAIN_WITH_KMS);
    const input = `import { localeDe } from "@cosmicdrift/kumiko-locale-de";\nexport const APP_FEATURES = [localeDe()] as const;\n`;
    const result = transformSecurityBaselineStackSource(input, runConfig);
    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(0);
  });

  it("reports manual when bin/main.ts passes no kmsMode to runProdApp", () => {
    writeMain(MAIN_WITHOUT_KMS);
    const result = transformSecurityBaselineStackSource(STUDIO_RUN_CONFIG, runConfig);
    expect(result.output).toBe(STUDIO_RUN_CONFIG);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.description).toContain("kmsMode");
  });

  it("reports manual when bin/main.ts disables rateLimit", () => {
    writeMain(`${MAIN_WITH_KMS}await runProdApp({ features: APP_FEATURES, rateLimit: false });\n`);
    const result = transformSecurityBaselineStackSource(STUDIO_RUN_CONFIG, runConfig);
    expect(result.output).toBe(STUDIO_RUN_CONFIG);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.description).toContain("rateLimit");
  });

  it("accepts kms, allowPlaintextPii and kmsMode as option names", () => {
    for (const options of ["kms: adapter", "allowPlaintextPii: reason", "kmsMode, auth"]) {
      writeMain(`await runProdApp({ features: APP_FEATURES, ${options} });\n`);
      const result = transformSecurityBaselineStackSource(STUDIO_RUN_CONFIG, runConfig);
      expect(result.rewrites).toHaveLength(1);
      expect(result.manual).toHaveLength(0);
    }
  });

  it("does not take the word kmsMode in a comment or a read as the option", () => {
    writeMain(
      `// kmsMode\nconst mode = appConfig.kmsMode;\nawait runProdApp({ features: APP_FEATURES });\n`,
    );
    const result = transformSecurityBaselineStackSource(STUDIO_RUN_CONFIG, runConfig);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(1);
  });

  it("ignores files other than src/run-config.ts", () => {
    writeMain(MAIN_WITH_KMS);
    const result = transformSecurityBaselineStackSource(
      STUDIO_RUN_CONFIG,
      join(root, "src", "other.ts"),
    );
    expect(result.output).toBe(STUDIO_RUN_CONFIG);
  });
});
