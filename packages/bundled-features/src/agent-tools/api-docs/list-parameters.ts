import {
  DEFAULT_LIST_LIMIT,
  entityListSchema,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { FILTER_OPS } from "../filter-ops.ts";
import { codeSpan } from "./markdown.ts";
import type { ApiDocsHandler } from "./model.ts";
import { type ApiDocsTexts, formatApiDocsText } from "./texts/index.ts";

export const LIST_INPUT_JSON_SCHEMA = z.toJSONSchema(entityListSchema, { io: "input" });

const LIST_PARAMETER_NAMES = Object.keys(LIST_INPUT_JSON_SCHEMA.properties ?? {}).sort();

export function listParameterText(texts: ApiDocsTexts, name: string): string | undefined {
  const text = Object.entries(texts.listParameters).find(([key]) => key === name)?.[1];
  return text === undefined
    ? undefined
    : formatApiDocsText(text, {
        default: DEFAULT_LIST_LIMIT,
        max: MAX_LIST_LIMIT,
        ops: FILTER_OPS.map(codeSpan).join(", "),
      });
}

/** True when the handler takes exactly the generated entity list input, so the shared
 *  list parameter texts describe its fields. */
export function takesEntityListInput(handler: ApiDocsHandler): boolean {
  const properties = handler.inputSchema?.["properties"];
  if (!isPlainObject(properties)) return false;
  const names = Object.keys(properties).sort();
  return (
    names.length === LIST_PARAMETER_NAMES.length &&
    names.every((name, index) => name === LIST_PARAMETER_NAMES[index])
  );
}
