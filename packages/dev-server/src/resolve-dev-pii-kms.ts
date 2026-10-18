import { randomBytes } from "node:crypto";
import {
  configureBlindIndexKey,
  configuredBlindIndexKey,
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  type KmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { isPersistentDevDb } from "./is-persistent-dev-db.ts";

export type DevPiiKmsResolution = {
  readonly kms: KmsAdapter | undefined;
  readonly blindIndexKey: string | undefined;
  /** True only when the ephemeral default minted the key, not when the app passed one. */
  readonly generatedBlindIndexKey: boolean;
  readonly mode: "app-kms" | "ephemeral-default" | "plaintext";
};

type DevPiiKmsOptions = {
  readonly kms?: KmsAdapter | false;
  readonly blindIndexKey?: string;
};

// Call right after configuring the resolved values. The returned restore only
// unsets what the ephemeral default installed, so a KMS a later test or the app
// configured survives.
export function captureEphemeralDevPiiKms(resolution: DevPiiKmsResolution): () => void {
  if (resolution.mode !== "ephemeral-default") return () => {};
  const ownKms = configuredPiiSubjectKms();
  const ownBlindIndexKey = resolution.generatedBlindIndexKey
    ? configuredBlindIndexKey()
    : undefined;
  return () => {
    if (ownKms !== undefined && configuredPiiSubjectKms() === ownKms) {
      configurePiiSubjectKms(undefined);
    }
    if (ownBlindIndexKey !== undefined && configuredBlindIndexKey() === ownBlindIndexKey) {
      configureBlindIndexKey(undefined);
    }
  };
}

export function resolveDevPiiKms(
  options: DevPiiKmsOptions,
  env: Record<string, string | undefined> = process.env,
): DevPiiKmsResolution {
  if (options.kms !== undefined && options.kms !== false) {
    return {
      kms: options.kms,
      blindIndexKey: options.blindIndexKey,
      generatedBlindIndexKey: false,
      mode: "app-kms",
    };
  }
  if (options.kms === false || isPersistentDevDb(env)) {
    return {
      kms: undefined,
      blindIndexKey: options.blindIndexKey,
      generatedBlindIndexKey: false,
      mode: "plaintext",
    };
  }
  return {
    kms: new InMemoryKmsAdapter(),
    blindIndexKey: options.blindIndexKey ?? randomBytes(32).toString("base64"),
    generatedBlindIndexKey: options.blindIndexKey === undefined,
    mode: "ephemeral-default",
  };
}
