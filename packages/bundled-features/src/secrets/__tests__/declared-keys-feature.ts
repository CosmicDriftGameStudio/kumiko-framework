import {
  defineFeature,
  type SecretKeyHandle,
  type SecretNamespaceHandle,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

export type DeclaredSecretKeys = {
  readonly plain: SecretKeyHandle;
  readonly systemOnly: SecretKeyHandle;
  readonly extra: SecretKeyHandle;
  readonly namespace: SecretNamespaceHandle;
};

// Test feature declaring the keys the secrets handlers accept: `plain` has no
// writeRoles (handler access alone), `systemOnly` narrows writes to SystemAdmin.
export function createDeclaredKeysFeature(): {
  readonly feature: ReturnType<typeof defineFeature>;
  readonly keys: DeclaredSecretKeys;
} {
  let keys: DeclaredSecretKeys | undefined;
  const feature = defineFeature("secrets-test", (r) => {
    keys = {
      plain: r.secret("plain.key", { label: { en: "Plain key" }, scope: "tenant" }),
      systemOnly: r.secret("system.only.key", {
        label: { en: "System-only key" },
        scope: "tenant",
        writeRoles: ["SystemAdmin"],
      }),
      extra: r.secret("extra.key", { label: { en: "Extra key" }, scope: "tenant" }),
      namespace: r.secretNamespace("hooks", {
        label: { en: "Hook tokens" },
        scope: "tenant",
        nameSchema: z
          .string()
          .min(1)
          .regex(/^[a-z][a-z0-9-]*$/),
      }),
    };
  });
  if (!keys) throw new Error("secrets-test feature setup did not run");
  return { feature, keys };
}
