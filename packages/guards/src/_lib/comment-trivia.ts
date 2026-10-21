import { ts } from "ts-morph";

export const COMMENT_KIND_LINE = "line";
export const COMMENT_KIND_BLOCK = "block";

export type CommentTrivia = {
  readonly start: number;
  readonly kind: typeof COMMENT_KIND_LINE | typeof COMMENT_KIND_BLOCK;
  readonly text: string;
};

// Tokens that end an operand without being identifiers or keywords.
const OPERAND_END_PUNCTUATION_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

// Reserved words after which an expression (so possibly a regex) starts.
const EXPRESSION_INTRODUCING_KEYWORDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.YieldKeyword,
  ts.SyntaxKind.AwaitKeyword,
  ts.SyntaxKind.ElseKeyword,
  ts.SyntaxKind.DoKeyword,
  ts.SyntaxKind.ExtendsKeyword,
  ts.SyntaxKind.DefaultKeyword,
]);

function isIdentifierOrKeyword(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.Identifier ||
    (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
  );
}

// After an operand end a `/` is division, not the start of a regex literal.
// Contextual keywords (`from`, `type`, `of`, ...) scan as keyword kinds but are
// valid member and variable names, so every non-introducing keyword counts. A `!`
// is the non-null postfix only when the token before it ended an operand.
function isOperandEnd(kind: ts.SyntaxKind, previousEndedOperand: boolean): boolean {
  if (kind === ts.SyntaxKind.ExclamationToken) return previousEndedOperand;
  if (OPERAND_END_PUNCTUATION_KINDS.has(kind)) return true;
  return isIdentifierOrKeyword(kind) && !EXPRESSION_INTRODUCING_KEYWORDS.has(kind);
}

const TRIVIA_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.NewLineTrivia,
]);

// The raw scanner always yields SlashToken for `/`; without the rescan a regex
// body like /\{/ would shift braceDepth and end a template early. After an
// operand the rescan would instead swallow `/ 2; // {` as a regex and hide the comment.
function rescanSlashAsRegex(
  scanner: ts.Scanner,
  kind: ts.SyntaxKind,
  previousEndedOperand: boolean,
): ts.SyntaxKind {
  if (previousEndedOperand) return kind;
  const reScanned = scanner.reScanSlashToken();
  return reScanned === ts.SyntaxKind.RegularExpressionLiteral ? reScanned : kind;
}

function closesTemplateSubstitution(
  templateBraceDepths: readonly number[],
  braceDepth: number,
): boolean {
  return (
    templateBraceDepths.length > 0 &&
    braceDepth === templateBraceDepths[templateBraceDepths.length - 1]
  );
}

// Template substitutions can nest braces (object literals, arrow bodies, other
// templates). The raw scanner tokenizes a `}` as a plain CloseBraceToken and
// never resumes template mode, so reScanTemplateToken() must run once brace
// depth returns to the level the substitution opened at.
export function scanCommentTrivia(fullText: string): CommentTrivia[] {
  const comments: CommentTrivia[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    fullText,
  );

  const templateBraceDepths: number[] = [];
  let braceDepth = 0;
  let previousEndedOperand = false;

  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    switch (kind) {
      case ts.SyntaxKind.SingleLineCommentTrivia:
      case ts.SyntaxKind.MultiLineCommentTrivia:
        comments.push({
          start: scanner.getTokenStart(),
          kind:
            kind === ts.SyntaxKind.SingleLineCommentTrivia ? COMMENT_KIND_LINE : COMMENT_KIND_BLOCK,
          text: scanner.getTokenText(),
        });
        break;
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.SlashEqualsToken:
        kind = rescanSlashAsRegex(scanner, kind, previousEndedOperand);
        break;
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
        templateBraceDepths.push(braceDepth);
        break;
      case ts.SyntaxKind.OpenBraceToken:
        braceDepth++;
        break;
      case ts.SyntaxKind.CloseBraceToken:
        if (closesTemplateSubstitution(templateBraceDepths, braceDepth)) {
          templateBraceDepths.pop();
          kind = scanner.reScanTemplateToken(false);
          continue;
        }
        if (braceDepth > 0) braceDepth--;
        break;
      default:
        break;
    }
    if (!TRIVIA_KINDS.has(kind)) previousEndedOperand = isOperandEnd(kind, previousEndedOperand);
    kind = scanner.scan();
  }
  return comments;
}
