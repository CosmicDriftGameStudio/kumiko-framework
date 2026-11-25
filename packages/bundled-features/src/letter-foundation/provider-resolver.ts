import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { egress } from "@cosmicdrift/kumiko-framework/http";
import type { ConfigAccessor } from "@cosmicdrift/kumiko-types/config";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { unprocessable } from "../shared/index.ts";
import {
  LETTER_INMEMORY_PROVIDER,
  LETTER_LIVE_CONFIG,
  LETTER_PROVIDER_EXTENSION,
  LetterErrors,
  LetterI18n,
} from "./constants.ts";
import {
  isLetterProviderPlugin,
  type LetterProvider,
  type LetterProviderCapabilities,
  type LetterProviderContext,
  type LetterProviderPlugin,
} from "./types.ts";

type ExtensionRegistry = Pick<Registry, "getExtensionUsages">;

/** What the choice of a provider needs; every handler and job context carries it. */
export type LetterProviderSelectionContext = {
  readonly registry: ExtensionRegistry;
  readonly config?: ConfigAccessor | undefined;
};

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

type ProviderUsage = ReturnType<ExtensionRegistry["getExtensionUsages"]>[number];

function pluginOf(usage: ProviderUsage): LetterProviderPlugin {
  if (!isLetterProviderPlugin(usage.options)) {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: provider "${usage.entityName}" registered without capabilities and build().`,
    );
  }
  return usage.options;
}

function chooseLiveUsage(usages: readonly ProviderUsage[]): ProviderUsage {
  const real = usages.filter((usage) => usage.entityName !== LETTER_INMEMORY_PROVIDER);
  const [only, ...others] = real;
  if (only === undefined) {
    throw new LetterProviderNotConfiguredError(
      "letter-foundation: live sending is on but no real provider is registered. Mount a letter-provider-* feature.",
    );
  }
  if (others.length > 0) {
    const names = real.map((usage) => usage.entityName).join(", ");
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: live sending needs exactly one real provider, found: ${names}.`,
    );
  }
  return only;
}

async function isLiveSwitchOn(ctx: LetterProviderSelectionContext): Promise<boolean> {
  return (ctx.config ? await ctx.config(LETTER_LIVE_CONFIG) : undefined) === true;
}

/** Production with the live switch off: the provider cannot be chosen, by design. */
export async function isProductionWithLiveSwitchOff(
  ctx: LetterProviderSelectionContext,
): Promise<boolean> {
  return process.env["NODE_ENV"] === "production" && !(await isLiveSwitchOn(ctx));
}

/**
 * The provider plugin for this process, never per tenant. Outside production the inmemory provider
 * runs whatever the live switch says, so a wrong environment can never send a letter. In production the
 * system config key `live` decides: off refuses instead of silently simulating, on picks the one real provider.
 */
export async function selectLetterProvider(
  ctx: LetterProviderSelectionContext,
): Promise<SelectedLetterProvider> {
  const usages = ctx.registry.getExtensionUsages(LETTER_PROVIDER_EXTENSION);
  if (process.env["NODE_ENV"] !== "production") {
    const inmemory = usages.find((usage) => usage.entityName === LETTER_INMEMORY_PROVIDER);
    if (inmemory === undefined) {
      const known = usages.map((usage) => usage.entityName).join(", ") || "<none>";
      throw new LetterProviderNotConfiguredError(
        `letter-foundation: provider "${LETTER_INMEMORY_PROVIDER}" is not registered. Registered providers: ${known}.`,
      );
    }
    return { name: LETTER_INMEMORY_PROVIDER, live: false, plugin: pluginOf(inmemory) };
  }
  if (!(await isLiveSwitchOn(ctx))) {
    throw new LetterProviderNotConfiguredError(
      `letter-foundation: in production the system config key "${LETTER_LIVE_CONFIG.name}" must be switched on.`,
    );
  }
  const usage = chooseLiveUsage(usages);
  return { name: usage.entityName, live: true, plugin: pluginOf(usage) };
}

export async function resolveLetterProvider(
  ctx: LetterProviderSelectionContext,
): Promise<ResolvedLetterProvider> {
  const { name, live, plugin } = await selectLetterProvider(ctx);
  const context: LetterProviderContext = { live, config: ctx.config, egress };
  return { name, live, capabilities: plugin.capabilities, provider: await plugin.build(context) };
}

function notConfigured(error: unknown): WriteResult<never> {
  if (!(error instanceof LetterProviderNotConfiguredError)) throw error;
  return unprocessable(LETTER_PROVIDER_NOT_CONFIGURED.code, LETTER_PROVIDER_NOT_CONFIGURED.i18nKey);
}

export async function selectLetterProviderOrFailure(
  ctx: LetterProviderSelectionContext,
): Promise<WriteResult<SelectedLetterProvider>> {
  try {
    return { isSuccess: true, data: await selectLetterProvider(ctx) };
  } catch (error) {
    return notConfigured(error);
  }
}

export async function resolveLetterProviderOrFailure(
  ctx: LetterProviderSelectionContext,
): Promise<WriteResult<ResolvedLetterProvider>> {
  try {
    return { isSuccess: true, data: await resolveLetterProvider(ctx) };
  } catch (error) {
    return notConfigured(error);
  }
}

/** A letter belongs to the provider it was approved with; letters without a stored name predate the field. */
export function isForeignProvider(
  letter: { readonly providerName?: string | null | undefined },
  resolvedName: string,
): boolean {
  return (
    letter.providerName !== null &&
    letter.providerName !== undefined &&
    letter.providerName !== resolvedName
  );
}

export function providerChangedFailure(): WriteResult<never> {
  return unprocessable(LetterErrors.providerChanged, LetterI18n.providerChanged);
}
