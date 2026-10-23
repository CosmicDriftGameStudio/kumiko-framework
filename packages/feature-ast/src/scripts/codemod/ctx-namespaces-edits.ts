import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import type { CodemodSite } from "./codemod-support.ts";

export type RenderRange = (start: number, end: number) => string;

export interface PlannedEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string | ((renderRange: RenderRange) => string);
}

// Edits are decided against the original program and applied once. An edit whose text is a
// function may pull the already-edited source of a sub-range into its own output, which is how a
// value moved into a namespace object keeps the edits made inside it.
export class EditPlan {
  readonly source: string;
  readonly rewrites: CodemodSite[] = [];
  readonly manual: CodemodSite[] = [];
  private readonly edits: PlannedEdit[] = [];

  constructor(readonly sourceFile: SourceFile) {
    this.source = sourceFile.getFullText();
  }

  add(edit: PlannedEdit): void {
    this.edits.push(edit);
  }

  replaceNode(node: Node, text: PlannedEdit["text"]): void {
    this.add({ start: node.getStart(), end: node.getEnd(), text });
  }

  recordRewrite(node: Node, description: string): void {
    this.rewrites.push(this.siteOf(node, description));
  }

  flagManual(node: Node, reason: string): void {
    this.manual.push(this.siteOf(node, reason));
  }

  deleteListItem(node: Node): void {
    const comma = node.getNextSiblingIfKind(SyntaxKind.CommaToken);
    this.add({ start: node.getFullStart(), end: (comma ?? node).getEnd(), text: "" });
  }

  insertIntoList(
    open: Node,
    items: readonly Node[],
    text: string | ((renderRange: RenderRange) => string),
  ): void {
    const last = items.at(-1);
    if (last === undefined) {
      const at = open.getStart() + 1;
      this.add({ start: at, end: at, text: composeText(text, " ", " ") });
    } else {
      const comma = last.getNextSiblingIfKind(SyntaxKind.CommaToken);
      const at = (comma ?? last).getEnd();
      this.add({
        start: at,
        end: at,
        text: comma === undefined ? composeText(text, ", ", "") : composeText(text, " ", ","),
      });
    }
  }

  render(): string {
    return renderEdits(this.source, this.edits, 0, this.source.length);
  }

  private siteOf(node: Node, description: string): CodemodSite {
    return {
      file: this.sourceFile.getFilePath(),
      line: this.sourceFile.getLineAndColumnAtPos(node.getStart()).line,
      description,
    };
  }
}

function composeText(
  text: string | ((renderRange: RenderRange) => string),
  before: string,
  after: string,
): string | ((renderRange: RenderRange) => string) {
  return typeof text === "string"
    ? `${before}${text}${after}`
    : (renderRange) => `${before}${text(renderRange)}${after}`;
}

function renderEdits(
  source: string,
  edits: readonly PlannedEdit[],
  rangeStart: number,
  rangeEnd: number,
): string {
  const inside = edits
    .filter((edit) => edit.start >= rangeStart && edit.end <= rangeEnd)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  let output = "";
  let cursor = rangeStart;
  for (const edit of inside) {
    if (edit.start < cursor) continue;
    const text =
      typeof edit.text === "string"
        ? edit.text
        : edit.text((start, end) => renderEdits(source, edits, start, end));
    output += source.slice(cursor, edit.start) + text;
    cursor = edit.end;
  }
  return output + source.slice(cursor, rangeEnd);
}
