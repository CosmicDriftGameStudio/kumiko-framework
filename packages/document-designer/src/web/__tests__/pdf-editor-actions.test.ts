import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  TemplateResolverErrors,
  TemplateResolverHandlers,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";
import { RendererPuppeteerClientQueries } from "@cosmicdrift/kumiko-renderer-puppeteer-client/qualified-names";
import { buildPdfActions, type PdfActionsInput } from "../pdf-editor-actions.ts";
import { type EditorState, SETTLE_MS, snapshotOf } from "../pdf-editor-draft.ts";
import { EMPTY_PDF_META } from "../pdf-meta.ts";
import type { TemplateDetail } from "../types.ts";

const failure: DispatcherError = {
  code: "nope",
  httpStatus: 400,
  i18nKey: "unknown.key",
  message: "Server refused",
};
const alreadyActive: DispatcherError = {
  code: TemplateResolverErrors.alreadyActive,
  httpStatus: 409,
  i18nKey: "unknown.key",
  message: "Already active",
  details: { reason: TemplateResolverErrors.alreadyActive },
};

const draft = { content: "<p>a</p>", meta: EMPTY_PDF_META };
const editorState: EditorState = {
  key: "tpl-1",
  draft,
  settled: draft,
  snapshot: snapshotOf(draft),
};

// A partial TemplateDetail: only the members the actions read.
const detailOf = (patch: Partial<TemplateDetail>) =>
  ({ id: "tpl-1", scope: "tenant", parentTemplateId: null, ...patch }) as unknown as TemplateDetail;

type WriteReply = { isSuccess: true; data: unknown } | { isSuccess: false; error: DispatcherError };

type Options = {
  readonly scope?: "system" | "tenant";
  readonly detail?: Partial<TemplateDetail>;
  readonly dirty?: boolean;
  readonly upsertReply?: WriteReply;
  readonly publishReply?: WriteReply;
  readonly queryReply?: WriteReply;
  readonly locale?: string;
};

function harness(options: Options = {}) {
  const writes: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const queries: string[] = [];
  const errors: Array<string | null> = [];
  const busy: Array<string | null> = [];
  const generated: unknown[] = [];
  const pendingLocales: string[] = [];
  const localeChanges: string[] = [];
  const modes: string[] = [];
  let reloads = 0;
  let state: EditorState | null = editorState;
  const settleTimer = { current: null as ReturnType<typeof setTimeout> | null };
  const autoPrintedFor = { current: null as string | null };
  const refetch = async () => {
    reloads += 1;
  };
  const scope = options.scope ?? "tenant";
  const dispatcher = {
    write: async (name: string, payload: Record<string, unknown>) => {
      writes.push({ name, payload });
      if (
        name === TemplateResolverHandlers.publish ||
        name === TemplateResolverHandlers.publishSystem
      )
        return options.publishReply ?? { isSuccess: true, data: undefined };
      return options.upsertReply ?? { isSuccess: true, data: { id: "saved-1" } };
    },
    query: async (name: string) => {
      queries.push(name);
      return options.queryReply ?? { isSuccess: true, data: { pageCount: 2 } };
    },
  };
  // Boundary cast: the actions read only these members of the editor state.
  const s = {
    host: { scope },
    doc: {
      locale: options.locale ?? "en",
      rowsQuery: { refetch },
      detailQuery: { refetch },
      setState: (next: EditorState | null | ((p: EditorState | null) => EditorState | null)) => {
        state = typeof next === "function" ? next(state) : next;
      },
    },
    settleTimer,
    server: { variableSchema: { v: 1 }, validationQuery: { refetch } },
    ui: {
      setBusy: (value: string | null) => busy.push(value),
      setActionError: (value: string | null) => errors.push(value),
      setMode: (value: string) => modes.push(value),
      setGenerated: (value: unknown) => generated.push(value),
      setPendingLocale: (value: string) => pendingLocales.push(value),
      setDraftEpoch: () => {},
      autoPrintedFor,
    },
  } as unknown as PdfActionsInput["s"];
  const actions = buildPdfActions({
    s,
    t: (key) => key,
    dispatcher: dispatcher as unknown as PdfActionsInput["dispatcher"],
    slug: "invoice",
    current: editorState,
    detail: detailOf(options.detail ?? {}),
    dirty: options.dirty ?? false,
    onLocaleChange: (locale) => localeChanges.push(locale),
  });
  return {
    actions,
    writes,
    queries,
    errors,
    busy,
    generated,
    pendingLocales,
    localeChanges,
    modes,
    autoPrintedFor,
    settleTimer,
    reloads: () => reloads,
    state: () => state,
  };
}

const names = (run: { writes: Array<{ name: string }> }) => run.writes.map((write) => write.name);

describe("save", () => {
  test("a tenant save upserts the tenant row, reloads and returns true", async () => {
    const run = harness();
    expect(await run.actions.save()).toBe(true);
    expect(names(run)).toEqual([TemplateResolverHandlers.upsertTenant]);
    expect(run.writes[0]?.payload).toMatchObject({ slug: "invoice", locale: "en" });
    expect(run.reloads()).toBe(3);
    expect(run.busy).toEqual(["save", null]);
  });

  test("a tenant override keeps the system row as its parent", async () => {
    const run = harness({ detail: { scope: "system", id: "sys-9" } });
    await run.actions.save();
    expect(run.writes[0]?.payload["parentTemplateId"]).toBe("sys-9");
  });

  test("a system save has no parent", async () => {
    const run = harness({ scope: "system", detail: { parentTemplateId: "x" } });
    await run.actions.save();
    expect(names(run)).toEqual([TemplateResolverHandlers.upsertSystem]);
    expect("parentTemplateId" in (run.writes[0]?.payload ?? {})).toBe(false);
  });

  test("a failed save shows the error, skips the reload and returns false", async () => {
    const run = harness({ upsertReply: { isSuccess: false, error: failure } });
    expect(await run.actions.save()).toBe(false);
    expect(run.errors).toEqual([null, "Server refused"]);
    expect(run.reloads()).toBe(0);
    expect(run.busy).toEqual(["save", null]);
  });
});

describe("publish", () => {
  test("a clean tenant row with a server copy only publishes it", async () => {
    const run = harness({ dirty: false });
    await run.actions.publish();
    expect(names(run)).toEqual([TemplateResolverHandlers.publish]);
    expect(run.writes[0]?.payload).toEqual({ id: "tpl-1" });
  });

  test("a dirty tenant row is saved first and then published under the saved id", async () => {
    const run = harness({ dirty: true });
    await run.actions.publish();
    expect(names(run)).toEqual([
      TemplateResolverHandlers.upsertTenant,
      TemplateResolverHandlers.publish,
    ]);
    expect(run.writes[1]?.payload).toEqual({ id: "saved-1" });
  });

  test("a system save already activates, so no extra publish follows", async () => {
    const run = harness({ scope: "system", detail: { scope: "system" } });
    await run.actions.publish();
    expect(names(run)).toEqual([TemplateResolverHandlers.upsertSystem]);
  });

  test("a failed save blocks the publish and keeps the save error", async () => {
    const run = harness({ dirty: true, upsertReply: { isSuccess: false, error: failure } });
    await run.actions.publish();
    expect(names(run)).toEqual([TemplateResolverHandlers.upsertTenant]);
    expect(run.errors).toEqual([null, "Server refused"]);
    expect(run.busy).toEqual(["publish", null]);
  });

  test("a refused publish is shown, except when the row is already active", async () => {
    const refused = harness({ publishReply: { isSuccess: false, error: failure } });
    await refused.actions.publish();
    expect(refused.errors).toEqual([null, "Server refused"]);

    const already = harness({ publishReply: { isSuccess: false, error: alreadyActive } });
    await already.actions.publish();
    expect(already.errors).toEqual([null]);
    expect(already.reloads()).toBe(3);
  });
});

describe("generatePdf and printOnce", () => {
  test("generating switches to the preview and stores the result with its snapshot", async () => {
    const run = harness();
    await run.actions.generatePdf();
    expect(run.modes).toEqual(["preview"]);
    expect(run.queries).toEqual([RendererPuppeteerClientQueries.previewPdf]);
    expect(run.generated).toEqual([{ forSnapshot: snapshotOf(draft), result: { pageCount: 2 } }]);
    expect(run.busy).toEqual(["pdf", null]);
  });

  test("a failed generation shows the error and stores nothing", async () => {
    const run = harness({ queryReply: { isSuccess: false, error: failure } });
    await run.actions.generatePdf();
    expect(run.errors).toEqual([null, "Server refused"]);
    expect(run.generated).toEqual([]);
  });

  test("printOnce prints a draft a single time", async () => {
    const run = harness();
    run.actions.printOnce();
    run.actions.printOnce();
    await Promise.resolve();
    expect(run.queries).toHaveLength(1);
    expect(run.autoPrintedFor.current).toBe(snapshotOf(draft));
  });
});

describe("requestLocale", () => {
  test("ignores the language that is already open", () => {
    const run = harness({ dirty: true });
    run.actions.requestLocale("en");
    expect(run.pendingLocales).toEqual([]);
    expect(run.localeChanges).toEqual([]);
  });

  test("asks before leaving unsaved edits, otherwise switches", () => {
    const dirty = harness({ dirty: true });
    dirty.actions.requestLocale("de");
    expect(dirty.pendingLocales).toEqual(["de"]);
    expect(dirty.localeChanges).toEqual([]);

    const clean = harness({ dirty: false });
    clean.actions.requestLocale("de");
    expect(clean.localeChanges).toEqual(["de"]);
  });
});

describe("draft settling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a changed draft is applied at once and settles after the pause", () => {
    const run = harness();
    const next = { content: "<p>b</p>", meta: EMPTY_PDF_META };
    run.actions.updateDraft(next);
    expect(run.state()?.draft).toBe(next);
    expect(run.state()?.settled).toBe(draft);
    jest.advanceTimersByTime(SETTLE_MS);
    expect(run.state()?.settled).toBe(next);
  });

  test("a second edit restarts the pause", () => {
    const run = harness();
    const first = { content: "<p>b</p>", meta: EMPTY_PDF_META };
    const second = { content: "<p>c</p>", meta: EMPTY_PDF_META };
    run.actions.updateDraft(first);
    jest.advanceTimersByTime(SETTLE_MS - 1);
    run.actions.updateDraft(second);
    jest.advanceTimersByTime(SETTLE_MS - 1);
    expect(run.state()?.settled).toBe(draft);
    jest.advanceTimersByTime(1);
    expect(run.state()?.settled).toBe(second);
  });

  test("resetting to the server copy replaces the whole state and cancels a pending settle", () => {
    const run = harness();
    run.actions.updateDraft({ content: "<p>b</p>", meta: EMPTY_PDF_META });
    run.actions.resetDraft(detailOf({ id: "tpl-2", content: "<p>server</p>", meta: null }));
    jest.advanceTimersByTime(SETTLE_MS);
    expect(run.state()?.key).toBe("tpl-2");
    expect(run.state()?.draft.content).toBe("<p>server</p>");
    expect(run.state()?.settled).toBe(run.state()?.draft);
    expect(run.errors).toEqual([null]);
  });
});
