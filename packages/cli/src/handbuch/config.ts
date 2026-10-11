import { readFileSync } from "node:fs";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";

const screensModuleSchema = z.object({
  path: z.string().min(1),
  export: z.string().min(1),
  idKey: z.string().min(1),
  titleKey: z.string().min(1),
  groupKey: z.string().min(1),
});

const inlineScreenSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  group: z.string().min(1),
});

const flowSourceSchema = z.object({
  repo: z.string().min(1),
  textsDir: z.string().includes("{locale}"),
  pageFlows: z.array(z.string().min(1)).default([]),
  pageGroup: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  flowGroup: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  flowTitles: z.record(z.string(), z.string()).default({}),
  shotsDir: z.string().optional(),
  uiStringsByLocale: z.record(z.string(), z.array(z.string().min(1))).optional(),
  uiStringFiles: z.array(z.string().min(1)).optional(),
});

const groupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

// Labels for the build locale; ids without an entry keep their base label.
const translationsSchema = z.object({
  title: z.string().min(1).optional(),
  groups: z.record(z.string(), z.string()).default({}),
  flows: z.record(z.string(), z.string()).default({}),
  steps: z.record(z.string(), z.string()).default({}),
});

export const handbuchConfigSchema = z
  .object({
    title: z.string().min(1),
    repo: z.string().min(1),
    locales: z.array(z.string().min(1)).min(1),
    defaultLocale: z.string().min(1),
    groups: z.array(groupSchema).min(1),
    translations: z.record(z.string(), translationsSchema).optional(),
    textsDir: z.string().includes("{locale}"),
    shotsDir: z.string().optional(),
    uiStrings: z.array(z.string().min(1)).optional(),
    uiStringPackages: z
      .array(
        z.object({
          package: z.string().min(1),
          files: z.array(z.string().min(1)).min(1),
          locale: z.string().min(1).optional(),
        }),
      )
      .optional(),
    flowSources: z.array(flowSourceSchema).optional(),
    sort: z.enum(["source", "title"]).default("source"),
    screensModule: screensModuleSchema.optional(),
    screens: z.array(inlineScreenSchema).optional(),
  })
  .refine((config) => config.locales.includes(config.defaultLocale), {
    message: "defaultLocale must be one of locales",
    path: ["defaultLocale"],
  })
  .refine((config) => !(config.screensModule && config.screens), {
    message: "use either screensModule or screens, not both",
    path: ["screens"],
  });

export type HandbuchConfig = z.infer<typeof handbuchConfigSchema>;
export type FlowSourceConfig = z.infer<typeof flowSourceSchema>;
export type ScreensModuleConfig = z.infer<typeof screensModuleSchema>;

export function parseHandbuchConfig(raw: unknown): HandbuchConfig {
  return handbuchConfigSchema.parse(raw);
}

export function loadHandbuchConfig(configPath: string): HandbuchConfig {
  const raw = parseJsonOrThrow<unknown>(readFileSync(configPath, "utf8"), configPath);
  return parseHandbuchConfig(raw);
}

// One build per language keeps the artifact under its file limit.
export function restrictToLocale(config: HandbuchConfig, locale: string): HandbuchConfig {
  if (!config.locales.includes(locale)) {
    throw new Error(`--locale ${locale} is not one of ${config.locales.join(", ")}`);
  }
  return { ...config, locales: [locale], defaultLocale: locale };
}
