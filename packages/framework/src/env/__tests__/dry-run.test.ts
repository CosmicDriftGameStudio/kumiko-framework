import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../engine/define-feature";
import { renderDryRun } from "../dry-run";
import { composeEnvSchema } from "../index";

function buildComposed() {
  const secretsFeature = defineFeature("secrets", (r) => {
    r.envSchema(
      z.object({
        KUMIKO_SECRETS_MASTER_KEY_V1: z
          .string()
          .describe("AES-256 master-key for tenant-secrets")
          .meta({
            kumiko: {
              pulumi: {
                name: "secretsMasterKey",
                generator: "openssl rand -base64 32",
                secret: true,
              },
            },
          }),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: z
          .string()
          .regex(/^\d+$/)
          .default("1")
          .describe("Active KEK version"),
      }),
    );
  });
  const authFeature = defineFeature("auth-email-password", (r) => {
    r.envSchema(
      z.object({
        JWT_SECRET: z
          .string()
          .min(32)
          .describe("Session JWT signing key (≥32 chars)")
          .meta({
            kumiko: { pulumi: { generator: "openssl rand -base64 48", secret: true } },
          }),
      }),
    );
  });
  const smtpFeature = defineFeature("channel-email-smtp", (r) => {
    r.envSchema(
      z.object({
        SMTP_HOST: z.string().optional().describe("Outbound SMTP host"),
      }),
    );
  });
  return composeEnvSchema({
    features: [secretsFeature, authFeature, smtpFeature],
    extend: z.object({
      STUDIO_ADMIN_EMAIL: z.email().describe("Bootstrap admin user"),
    }),
  });
}

describe("renderDryRun", () => {
  it("human mode groups by required / optional / defaulted with feature attribution", () => {
    const composed = buildComposed();
    const out = renderDryRun(composed, "human");
    expect(out).toContain("Required env-vars:");
    expect(out).toContain("Optional env-vars:");
    expect(out).toContain("Defaulted env-vars:");
    expect(out).toContain("JWT_SECRET");
    expect(out).toContain("(auth-email-password)");
    expect(out).toContain("Session JWT signing key");
    expect(out).toContain("STUDIO_ADMIN_EMAIL");
    expect(out).toContain("(app)");
    expect(out).toContain("(channel-email-smtp)");
    expect(out).toContain('[default: "1"]');
  });

  it("json mode emits structured data with pulumiName per entry", () => {
    const composed = buildComposed();
    const out = renderDryRun(composed, "json", { pulumiPrefix: "studio" });
    const parsed = JSON.parse(out) as {
      required: { name: string; feature: string; pulumiName: string; description?: string }[];
      optional: { name: string }[];
      withDefault: { name: string; default: unknown }[];
    };
    const jwt = parsed.required.find((r) => r.name === "JWT_SECRET");
    expect(jwt?.feature).toBe("auth-email-password");
    expect(jwt?.pulumiName).toBe("studioJwtSecret");
    expect(jwt?.description).toContain("Session JWT");
    const smtp = parsed.optional.find((r) => r.name === "SMTP_HOST");
    expect(smtp).toBeDefined();
    const ver = parsed.withDefault.find((r) => r.name.endsWith("CURRENT_VERSION"));
    expect(ver?.default).toBe("1");
  });

  it("pulumi mode emits `pulumi config set` lines, omitting optional+defaulted", () => {
    const composed = buildComposed();
    const out = renderDryRun(composed, "pulumi", { pulumiPrefix: "studio" });
    expect(out).toContain(
      'pulumi config set --secret studioJwtSecret "$(openssl rand -base64 48)"',
    );
    expect(out).toContain(
      'pulumi config set --secret studioSecretsMasterKey "$(openssl rand -base64 32)"',
    );
    expect(out).toContain('pulumi config set studioStudioAdminEmail "<set-me>"');
    // Optional + default skipped:
    expect(out).not.toContain("SMTP_HOST");
    expect(out).not.toContain("CURRENT_VERSION");
  });

  it("k8s mode emits a Secret manifest", () => {
    const composed = buildComposed();
    const out = renderDryRun(composed, "k8s", {
      k8sName: "studio-env",
      k8sNamespace: "studio",
    });
    expect(out).toContain("apiVersion: v1");
    expect(out).toContain("kind: Secret");
    expect(out).toContain("name: studio-env");
    expect(out).toContain("namespace: studio");
    expect(out).toContain('JWT_SECRET: "<set-me>"');
    expect(out).toContain('KUMIKO_SECRETS_MASTER_KEY_V1: "<set-me>"');
  });
});
