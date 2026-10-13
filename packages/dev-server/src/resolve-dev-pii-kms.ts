import { randomBytes } from "node:crypto";
import { InMemoryKmsAdapter, type KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { isPersistentDevDb } from "./is-persistent-dev-db.js";

export type DevPiiKmsResolution = {
  readonly kms: KmsAdapter | undefined;
  readonly blindIndexKey: string | undefined;
  readonly mode: "app-kms" | "ephemeral-default" | "plaintext";
};

type DevPiiKmsOptions = {
  readonly kms?: KmsAdapter | false;
  readonly blindIndexKey?: string;
};

export function resolveDevPiiKms(
  options: DevPiiKmsOptions,
  env: Record<string, string | undefined> = process.env,
): DevPiiKmsResolution {
  if (options.kms !== undefined && options.kms !== false) {
    return { kms: options.kms, blindIndexKey: options.blindIndexKey, mode: "app-kms" };
  }
  if (options.kms === false || isPersistentDevDb(env)) {
    return { kms: undefined, blindIndexKey: options.blindIndexKey, mode: "plaintext" };
  }
  return {
    kms: new InMemoryKmsAdapter(),
    blindIndexKey: options.blindIndexKey ?? randomBytes(32).toString("base64"),
    mode: "ephemeral-default",
  };
}
