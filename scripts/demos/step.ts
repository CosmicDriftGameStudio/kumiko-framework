// Step-builders for `scripts/demos/*.ts`. Each demo file imports `step` and
// exports an ordered list of steps via `demo({...})` (see ./demo.ts). Iter 1
// ships only the schema + dry-run validation; Iter 2 (`scripts/record-demo.ts`)
// will consume the steps to drive tmux + Playwright + ffmpeg → GIF.
//
// Design (Plan-Doc D10): the same demo file feeds BOTH the GIF recorder and
// the captions JSON next to it (Plan-Doc D11). Captions are co-defined with
// the step so a recording can never drift from its overlay text.

export type Caption = {
  readonly de: string;
  readonly en: string;
};

// `cli`  — typed into the left pane (the terminal). `type` is the verbatim
//          command, including newlines if the command spans multiple lines.
// `browser` — driven via Playwright in the right pane.
//   - `navigate`: full URL
//   - `click`: selector (data-test attr preferred — survives style refactors)
//   - `waitFor`: selector that must resolve before the step is "done"
// `editor` — the recorder swaps the left pane to an editor view and types the
//            given source code into the file at `file` (path relative to the
//            scaffolded app dir).
export type Step =
  | { readonly kind: "cli"; readonly type: string; readonly caption?: Caption }
  | {
      readonly kind: "browser";
      readonly navigate?: string;
      readonly click?: string;
      readonly waitFor?: string;
      readonly caption?: Caption;
    }
  | {
      readonly kind: "editor";
      readonly file: string;
      readonly write: string;
      readonly caption?: Caption;
    };

type CliInput = { readonly type: string; readonly caption?: Caption };
type BrowserInput = {
  readonly navigate?: string;
  readonly click?: string;
  readonly waitFor?: string;
  readonly caption?: Caption;
};
type EditorInput = {
  readonly file: string;
  readonly write: string;
  readonly caption?: Caption;
};

export const step = {
  cli: (input: CliInput): Step => ({ kind: "cli", ...input }),
  browser: (input: BrowserInput): Step => {
    if (!input.navigate && !input.click && !input.waitFor) {
      throw new Error("step.browser: at least one of navigate/click/waitFor required");
    }
    return { kind: "browser", ...input };
  },
  editor: (input: EditorInput): Step => ({ kind: "editor", ...input }),
};
