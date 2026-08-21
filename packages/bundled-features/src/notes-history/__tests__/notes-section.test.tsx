// @runtime client
// DOM test for the notes-history entry display: body/meta must render as two
// visually separate lines, the author must never be the raw authorId, and the
// timestamp must be human-formatted — not the concatenated single-line dump
// this test guards against (see notes-section.tsx for the fix).
// Provider wrapper is local — renderer-web → bundled-features forbids importing
// renderer-web test-utils from here.

import { describe, expect, test } from "bun:test";
import { createStore, type Dispatcher, type DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  formatWhen,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer-web";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NotesHistoryQueries } from "../constants";
import { defaultTranslations } from "../web/i18n";
import { NotesSection } from "../web/notes-section";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const stubResolver = createStaticLocaleResolver();

type NoteRowFixture = {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly body: string;
  readonly insertedAt: string;
};

const AUTHOR_ID = "01a0244b-71f2-76e4-854f-e360584f01e9";
const AUTHOR_NAME = "Jamie Vance";
const INSERTED_AT = "2026-08-21T12:28:41.580Z";
const NOTE_BODY = "Vertragsunterlagen per Post verschickt.";

const NOTE_ROWS: readonly NoteRowFixture[] = [
  {
    id: "note-1",
    entityType: "contact",
    entityId: "contact-1",
    authorId: AUTHOR_ID,
    authorName: AUTHOR_NAME,
    body: NOTE_BODY,
    insertedAt: INSERTED_AT,
  },
  {
    id: "note-2",
    entityType: "contact",
    entityId: "contact-1",
    authorId: "02b1355c-8203-87f5-9650-f471695002f0",
    authorName: null,
    body: "Legacy entry predating authorName.",
    insertedAt: "2026-07-01T09:00:00.000Z",
  },
];

function makeDispatcher(): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const query = (async (type: string) => {
    if (type === NotesHistoryQueries.noteList) {
      return { isSuccess: true, data: { rows: NOTE_ROWS } };
    }
    return { isSuccess: true, data: null };
  }) as unknown as Dispatcher["query"];
  return {
    write: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["write"],
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderSection(): ReturnType<typeof render> {
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <LiveEventsProvider value={stubLiveEvents}>
            <DispatcherProvider dispatcher={makeDispatcher()}>{children}</DispatcherProvider>
          </LiveEventsProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  return render(<NotesSection entityName="contact" entityId="contact-1" />, { wrapper });
}

describe("NotesSection — entry display", () => {
  test("note body and meta line render as two distinct nodes, not one run-on line", async () => {
    const view = renderSection();
    await waitFor(() => {
      if (view.queryByTestId("notes-section-row-note-1-body") === null) {
        throw new Error("row not rendered yet");
      }
    });
    const bodyEl = view.getByTestId("notes-section-row-note-1-body");
    const metaEl = view.getByTestId("notes-section-row-note-1-meta");
    expect(bodyEl).not.toBe(metaEl);
    expect(bodyEl.textContent).toBe(NOTE_BODY);
    expect(metaEl.textContent).not.toContain(NOTE_BODY);

    const row = view.getByTestId("notes-section-row-note-1");
    expect(row.className).toContain("flex-col");
  });

  test("a stamped authorName renders as the author, never the raw authorId", async () => {
    const view = renderSection();
    await waitFor(() => {
      if (view.queryByTestId("notes-section-row-note-1-meta") === null) {
        throw new Error("row not rendered yet");
      }
    });
    const metaEl = view.getByTestId("notes-section-row-note-1-meta");
    expect(metaEl.textContent).not.toContain(AUTHOR_ID);
    expect(metaEl.textContent).toContain(AUTHOR_NAME);
  });

  test("a null authorName (legacy row, or shredded author) renders the placeholder", async () => {
    const view = renderSection();
    await waitFor(() => {
      if (view.queryByTestId("notes-section-row-note-2-meta") === null) {
        throw new Error("row not rendered yet");
      }
    });
    const metaEl = view.getByTestId("notes-section-row-note-2-meta");
    expect(metaEl.textContent).toContain("Unknown author");
  });

  test("date renders formatted, never the raw ISO timestamp", async () => {
    const view = renderSection();
    await waitFor(() => {
      if (view.queryByTestId("notes-section-row-note-1-meta") === null) {
        throw new Error("row not rendered yet");
      }
    });
    const metaEl = view.getByTestId("notes-section-row-note-1-meta");
    expect(metaEl.textContent).not.toContain(INSERTED_AT);
    expect(metaEl.textContent).toContain(formatWhen(INSERTED_AT));
  });
});
