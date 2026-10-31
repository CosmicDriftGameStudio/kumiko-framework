import { bootRuleError } from "./boot-rule.ts";
import { LIST_TABLE_RULES } from "./list-table-rules.ts";

export function rejectUnknownKeys(
  where: string,
  block: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw bootRuleError(LIST_TABLE_RULES.unknownKeys, {
      message:
        `${where} ${block} has unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
        `Allowed keys: ${allowed.join(", ")}.`,
    });
  }
}
