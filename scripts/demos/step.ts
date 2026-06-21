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
/** Steps marked `recordingOnly: true` show in the GIF but the E2E runner
 *  skips them. Use for actions that only make sense in front of a viewer
 *  (typing a new feature file when the scaffold can't yet auto-mount it,
 *  showing intermediate states the test doesn't need to verify). */
export type StepCommon = {
  readonly recordingOnly?: boolean;
};

export type Step = StepCommon &
  (
    | {
        readonly kind: "cli";
        readonly type: string;
        readonly caption?: Caption;
        /** Sleep AFTER the command lands (ms). Default 2500. Use longer
         *  values for installs (~30s for bun install). */
        readonly waitMs?: number;
        /** If set, after typing the command wait for this localhost TCP port
         *  to accept connections before moving on. Better than a fixed sleep
         *  for `bun dev` / `docker compose up -d`. */
        readonly waitForPort?: number;
      }
    | {
        readonly kind: "browser";
        readonly navigate?: string;
        readonly click?: string;
        readonly waitFor?: string;
        /** Type into a selector. Recorder shows the typing visually; the
         *  E2E runner page.fill()s it. Keys are selectors (`#login-email`),
         *  values are the text to enter (demo credentials are OK in source
         *  — admin@<app>.local / changeme is the scaffold default). */
        readonly fill?: Readonly<Record<string, string>>;
        readonly caption?: Caption;
      }
    | {
        readonly kind: "editor";
        readonly file: string;
        readonly write: string;
        readonly caption?: Caption;
      }
  );

type CliInput = StepCommon & {
  readonly type: string;
  readonly caption?: Caption;
  readonly waitMs?: number;
  readonly waitForPort?: number;
};
type BrowserInput = StepCommon & {
  readonly navigate?: string;
  readonly click?: string;
  readonly waitFor?: string;
  readonly fill?: Readonly<Record<string, string>>;
  readonly caption?: Caption;
};
type EditorInput = StepCommon & {
  readonly file: string;
  readonly write: string;
  readonly caption?: Caption;
};

export const step = {
  cli: (input: CliInput): Step => ({ kind: "cli", ...input }),
  browser: (input: BrowserInput): Step => {
    if (!input.navigate && !input.click && !input.waitFor && !input.fill) {
      throw new Error("step.browser: at least one of navigate/click/waitFor/fill required");
    }
    return { kind: "browser", ...input };
  },
  editor: (input: EditorInput): Step => ({ kind: "editor", ...input }),
};
