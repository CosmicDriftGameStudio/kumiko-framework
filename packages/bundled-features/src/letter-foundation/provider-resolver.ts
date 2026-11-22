import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { egress } from "@cosmicdrift/kumiko-framework/http";
import { LETTER_ENV, LETTER_INMEMORY_PROVIDER, LETTER_PROVIDER_EXTENSION } from "./constants.ts";
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

/**
 * The provider plugin for this process, chosen from the environment and never per tenant. Without
 * the live switch the inmemory provider runs, so a missing or wrong setting cannot send a real
 * letter. The boot rule on the live switch has already refused `LETTER_LIVE=true` outside production.
 */
export function selectLetterProvider(
  registry: ExtensionRegistry,
  env: LetterEnvSource = process.env,
): SelectedLetterProvider {
  const live = env[LETTER_ENV.live] === "true";
  const name = live ? env[LETTER_ENV.provider] : LETTER_INMEMORY_PROVIDER;
  const usages = registry.getExtensionUsages(LETTER_PROVIDER_EXTENSION);
  const known = usages.map((usage) => usage.entityName).join(", ") || "<none>";
  if (name === undefined || name.length === 0) {
    throw new Error(
      `letter-foundation: ${LETTER_ENV.live}=true needs ${LETTER_ENV.provider}. Registered providers: ${known}.`,
    );
  }
  const usage = usages.find((candidate) => candidate.entityName === name);
  if (usage === undefined) {
    throw new Error(
      `letter-foundation: provider "${name}" is not registered. Registered providers: ${known}. Mount the matching letter-provider-* feature.`,
    );
  }
  if (!isLetterProviderPlugin(usage.options)) {
    throw new Error(
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
