import type {
  TemplateImagesVariableDef,
  TemplateListVariableDef,
  TemplateScalarVariableDef,
  TemplateVariableDef,
  TemplateVariables,
} from "@cosmicdrift/kumiko-types/config";
import * as z from "zod";
import { InternalError } from "../errors/index.ts";
import type { Registry } from "./types/index.ts";

type CommonOptions = { readonly label?: string; readonly required?: boolean };

// Builders keep declarations terse and the `type` discriminant out of app code.
export const templateVariable = {
  text: (opts: CommonOptions & { readonly example?: string } = {}): TemplateScalarVariableDef => ({
    type: "text",
    ...opts,
  }),
  link: (opts: CommonOptions & { readonly example?: string } = {}): TemplateScalarVariableDef => ({
    type: "link",
    ...opts,
  }),
  richText: (
    opts: CommonOptions & { readonly example?: string } = {},
  ): TemplateScalarVariableDef => ({ type: "richText", ...opts }),
  money: (
    opts: CommonOptions & {
      readonly example?: number | { readonly amount: number; readonly currency: string };
    } = {},
  ): TemplateScalarVariableDef => ({ type: "money", ...opts }),
  date: (opts: CommonOptions & { readonly example?: string } = {}): TemplateScalarVariableDef => ({
    type: "date",
    ...opts,
  }),
  percent: (
    opts: CommonOptions & { readonly example?: number } = {},
  ): TemplateScalarVariableDef => ({ type: "percent", ...opts }),
  images: (opts: CommonOptions = {}): TemplateImagesVariableDef => ({ type: "images", ...opts }),
  list: (
    item: Readonly<Record<string, TemplateScalarVariableDef>>,
    opts: CommonOptions & { readonly example?: readonly Readonly<Record<string, unknown>>[] } = {},
  ): TemplateListVariableDef => ({ type: "list", item, ...opts }),
} as const;

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

function isSafeLinkUrl(value: string): boolean {
  try {
    return LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

const linkSchema = z.string().refine(isSafeLinkUrl, "must be an http, https or mailto URL");

const moneySchema = z.union([
  z.number().int(),
  z.object({
    amount: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
]);

const dateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

function scalarToZod(def: TemplateScalarVariableDef): z.ZodType {
  switch (def.type) {
    case "text":
      return z.string();
    case "richText":
      return z.string();
    case "link":
      return linkSchema;
    case "money":
      return moneySchema;
    case "date":
      return dateSchema;
    case "percent":
      return z.number().finite();
  }
}

const imagesSchema = z.union([z.string(), z.array(z.string())]);

function variableToZod(def: TemplateVariableDef): z.ZodType {
  if (def.type === "images") return imagesSchema;
  if (def.type !== "list") return scalarToZod(def);
  return z.array(
    z.object(
      Object.fromEntries(
        Object.entries(def.item).map(([name, item]) => [name, withOptionality(item)]),
      ),
    ),
  );
}

function withOptionality(def: TemplateVariableDef): z.ZodType {
  const schema = variableToZod(def);
  return def.required === true ? schema : schema.optional();
}

export function templateVariablesToZod(variables: TemplateVariables): z.ZodObject {
  return z.object(
    Object.fromEntries(
      Object.entries(variables).map(([name, def]) => [name, withOptionality(def)]),
    ),
  );
}

// Validates only: the caller keeps passing the original data on, because
// parsing would strip keys the delivery adds itself (unsubscribeUrl, fromName).
export function assertNotificationVariables(
  registry: Pick<Registry, "getAllNotifications">,
  notificationType: string,
  data: Readonly<Record<string, unknown>> | undefined,
): void {
  const definition = registry.getAllNotifications().get(notificationType);
  if (definition?.template !== undefined && definition.variables !== undefined) {
    const parsed = templateVariablesToZod(definition.variables).safeParse(data ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new InternalError({
        message: `notification "${notificationType}" has invalid variables: ${issues}`,
      });
    }
  }
}
