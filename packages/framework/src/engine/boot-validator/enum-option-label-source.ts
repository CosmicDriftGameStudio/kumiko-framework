import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { parseFieldOptionsRef } from "../parse-ref-target.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { SCREEN_RULES } from "./screens-rules.ts";

const OPTION_FIELD_TYPES: ReadonlySet<string> = new Set(["select", "multiSelect"]);

// enumOption sits under renderer, format, statusFormat and other screen keys, so the whole
// screen definition is walked.
export function validateEnumOptionLabelSources(
  featureName: string,
  screenId: string,
  screen: unknown,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const visited = new WeakSet<object>();

  function checkEnumOption(spec: Record<string, unknown>): void {
    const prefix = `[Feature ${featureName}] Screen "${screenId}" enumOption`;
    const hasKeyPrefix = typeof spec["keyPrefix"] === "string";
    const optionsOf = spec["optionsOf"];
    if (hasKeyPrefix === (optionsOf !== undefined)) {
      throw bootRuleError(SCREEN_RULES.enumOptionLabelSourceInvalid, {
        message: `${prefix} must set exactly one of keyPrefix or optionsOf.`,
      });
    }
    if (optionsOf === undefined) return;
    const ref = typeof optionsOf === "string" ? parseFieldOptionsRef(optionsOf) : undefined;
    if (ref === undefined) {
      throw bootRuleError(SCREEN_RULES.enumOptionLabelSourceInvalid, {
        message: `${prefix} optionsOf "${String(optionsOf)}" is not "<feature>:<entity>.<field>".`,
      });
    }
    const field = featureMap.get(ref.featureName)?.entities?.[ref.entityName]?.fields?.[
      ref.fieldName
    ];
    if (field === undefined || !OPTION_FIELD_TYPES.has(field.type)) {
      throw bootRuleError(SCREEN_RULES.enumOptionLabelSourceInvalid, {
        message: `${prefix} optionsOf "${String(optionsOf)}" does not name a select or multiSelect field of a mounted feature's entity.`,
      });
    }
  }

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isPlainObject(node)) return;
    const proto = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== null) return;
    if (visited.has(node)) return;
    visited.add(node);
    if (node["format"] === "enumOption") checkEnumOption(node);
    for (const value of Object.values(node)) walk(value);
  }

  walk(screen);
}
