import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { egress } from "@cosmicdrift/kumiko-framework/http";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { unprocessable } from "../shared/index.ts";
import { LETTER_ENV, LETTER_INMEMORY_PROVIDER, LETTER_PROVIDER_EXTENSION } from "./constants.ts";
import { letterLiveEnvRule } from "./env-schema.ts";
import {
  isLetterProviderPlugin,
  type LetterProvider,
  type LetterProviderCapabilities,
  type LetterProviderContext,
  type LetterProviderPlugin,
} from "./types.ts";

type LetterEnvSource = Readonly<Record<string, string | undefined>>;
type ExtensionRegistry = Pick<Registry, "getExtensionUsages">;

export type SelectedLetterProvider = {
  readonly name: string;
  readonly live: boolean;
  readonly plugin: LetterProviderPlugin;
};

export type ResolvedLetterProvider = {
  readonly name: string;
  readonly live: boolean;
  readonly capabilities: LetterProviderCapabilities;
  readonly provider: LetterProvider;
};

export const LETTER_PROVIDER_NOT_CONFIGURED = {
  code: "letter_provider_not_configured",
  i18nKey: "letter-foundation.errors.providerNotConfigured",
} as const;

export class LetterProviderNotConfiguredError extends Error {}

function wantsLiveProvider(env: LetterEnvSource): boolean {
  const value = env[LETTER_ENV.live];
  if (value === "true") return true;
  if (value === "false") return false;
  if (env["NODE_ENV"] === "production") {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: in production ${LETTER_ENV.live}=true or ${LETTER_ENV.live}=false must be set.`,
    );
  }
  return false;
}

/**
 * The provider plugin for this process, chosen from the environment and never per tenant. Outside
 * production the inmemory provider runs unless the live switch is on; in production the switch must
 * say `true` or `false`, so a forgotten setting fails instead of silently simulating. The live switch
 * is checked here against the same env source as the boot rule, so it fails closed even when that rule never ran.
 */
export function selectLetterProvider(
  registry: ExtensionRegistry,
  env: LetterEnvSource = process.env,
): SelectedLetterProvider {
  const live = wantsLiveProvider(env);
  const liveRefusal = live ? letterLiveEnvRule("true", env) : undefined;
  if (liveRefusal !== undefined) {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: ${LETTER_ENV.live}=true refused: ${liveRefusal}.`,
    );
  }
  const name = live ? env[LETTER_ENV.provider] : LETTER_INMEMORY_PROVIDER;
  const usages = registry.getExtensionUsages(LETTER_PROVIDER_EXTENSION);
  const known = usages.map((usage) => usage.entityName).join(", ") || "<none>";
  if (name === undefined || name.length === 0) {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: ${LETTER_ENV.live}=true needs ${LETTER_ENV.provider}. Registered providers: ${known}.`,
    );
  }
  const usage = usages.find((candidate) => candidate.entityName === name);
  if (usage === undefined) {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: provider "${name}" is not registered. Registered providers: ${known}. Mount the matching letter-provider-* feature.`,
    );
  }
  if (!isLetterProviderPlugin(usage.options)) {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: provider "${name}" registered without capabilities and build().`,
    );
  }
  return { name, live, plugin: usage.options };
}

export async function resolveLetterProvider(
  registry: ExtensionRegistry,
  env: LetterEnvSource = process.env,
): Promise<ResolvedLetterProvider> {
  const { name, live, plugin } = selectLetterProvider(registry, env);
  const context: LetterProviderContext = { live, env, egress };
  return { name, live, capabilities: plugin.capabilities, provider: await plugin.build(context) };
}

function notConfigured(error: unknown): WriteResult<never> {
  if (!(error instanceof LetterProviderNotConfiguredError)) throw error;
  return unprocessable(LETTER_PROVIDER_NOT_CONFIGURED.code, LETTER_PROVIDER_NOT_CONFIGURED.i18nKey);
}

export function selectLetterProviderOrFailure(
  registry: ExtensionRegistry,
): WriteResult<SelectedLetterProvider> {
  try {
    return { isSuccess: true, data: selectLetterProvider(registry) };
  } catch (error) {
    return notConfigured(error);
  }
}

export async function resolveLetterProviderOrFailure(
  registry: ExtensionRegistry,
): Promise<WriteResult<ResolvedLetterProvider>> {
  try {
    return { isSuccess: true, data: await resolveLetterProvider(registry) };
  } catch (error) {
    return notConfigured(error);
  }
}
