import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";

// Strings come first in each alternation, so comment and comma patterns
// inside string literals are matched as part of the string and kept.
const STRING_OR_COMMENT = /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const STRING_OR_TRAILING_COMMA = /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g;

// biome.json and tsconfig.json accept comments and trailing commas; strip both
// (outside strings) so they parse as JSON.
export function parseJsonc(source: string, context: string): unknown {
  const withoutComments = source.replace(STRING_OR_COMMENT, (match) =>
    match.startsWith('"') ? match : "",
  );
  const withoutTrailingCommas = withoutComments.replace(
    STRING_OR_TRAILING_COMMA,
    (match, afterComma: string | undefined) => afterComma ?? match,
  );
  return parseJsonOrThrow<unknown>(withoutTrailingCommas, context);
}
