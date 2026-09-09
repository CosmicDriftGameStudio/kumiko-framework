// Render test against real i18n bundles (catches missing keys — the Section
// must never show raw "userDataRights.privacyCenter.*" keys) plus QN wiring
// (the dispatched query/handler names). Restriction/deletion (status-driven
// branches) moved to declarative fields/actions with fw#2312 (feature.ts,
// booted in inspector-screens.boot.test.ts) — only Export (ExportSection) is
// still a React component. Provider wrapper is local (the renderer-web →
// bundled-features dependency direction forbids importing test-utils).

import { describe, expect, spyOn, test } from "bun:test";
import { createStore, type Dispatcher, type DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { UserQueries } from "../../../user";
import {
  EXPORT_JOB_STATUS,
  USER_ME_QUERY,
  UserDataRightsHandlers,
  UserDataRightsQueries,
} from "../../constants";
import { EXPORT_JOB_STATUS as SCHEMA_EXPORT_JOB_STATUS } from "../../schema/export-job";
import { defaultTranslations } from "../i18n";
import { ExportSection, formatDate } from "../privacy-center-screen";

const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const stubResolver = createStaticLocaleResolver();

type QueryResponses = {
  readonly exportStatus?: unknown;
  readonly auditLog?: unknown;
  /** Signed URL returned by downloadByJob — drives postWithDownload navigation. */
  readonly downloadUrl?: string;
};

function makeDispatcher(
  responses: QueryResponses,
  writes: Array<{ type: string; payload: unknown }>,
  queries: Array<{ type: string; payload: unknown }> = [],
): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const query = (async (type: string, payload: unknown) => {
    queries.push({ type, payload });
    if (type === UserDataRightsQueries.exportStatus) {
      return { isSuccess: true, data: responses.exportStatus ?? { hasJob: false } };
    }
    if (type === UserDataRightsQueries.myAuditLog) {
      return { isSuccess: true, data: responses.auditLog ?? { rows: [] } };
    }
    if (type === UserDataRightsQueries.downloadByJob) {
      if (responses.downloadUrl === undefined) {
        return { isSuccess: true, data: null };
      }
      return { isSuccess: true, data: { url: responses.downloadUrl } };
    }
    return { isSuccess: true, data: null };
  }) as unknown as Dispatcher["query"];
  const write = (async (type: string, payload: unknown) => {
    writes.push({ type, payload });
    return { isSuccess: true, data: {} };
  }) as unknown as Dispatcher["write"];
  return {
    write,
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderExportSection(responses: QueryResponses): {
  view: ReturnType<typeof render>;
  writes: Array<{ type: string; payload: unknown }>;
  queries: Array<{ type: string; payload: unknown }>;
} {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const queries: Array<{ type: string; payload: unknown }> = [];
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <LiveEventsProvider value={stubLiveEvents}>
            <DispatcherProvider dispatcher={makeDispatcher(responses, writes, queries)}>
              {children}
            </DispatcherProvider>
          </LiveEventsProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  // ExportSection renders no Section/title of its own in production (the
  // renderer's ExtensionSectionMount supplies that) — a plain testId wrapper
  // here is test-only scaffolding to detect "mounted".
  const view = render(
    <div data-testid="export-section-root">
      <ExportSection />
    </div>,
    { wrapper },
  );
  return { view, writes, queries };
}

async function waitForMount(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => {
    if (view.queryByTestId("export-section-root") === null) {
      throw new Error("not mounted yet");
    }
  });
}

/** Export status is a second async query — mount alone races status-dependent UI. */
async function waitForTestId(view: ReturnType<typeof render>, testId: string): Promise<void> {
  await waitFor(() => {
    if (view.queryByTestId(testId) === null) {
      throw new Error(`${testId} not ready`);
    }
  });
}

async function waitForDownloadReady(view: ReturnType<typeof render>): Promise<void> {
  await waitForTestId(view, "privacy-export-download");
}

// CI runs this file in its own `bun test` process (own ci.yml step), NOT in the
// shared `kumiko check` run — see bunfig.ci.toml pathIgnorePatterns. In the shared
// single-process happy-dom, the global `afterEach` from `test-setup/dom.preload.ts`
// plus accumulated global DOM/event state across ~30 prior DOM test files corrupts
// these in-flight renders (#457-class). A fresh process has no such accumulation.
// The QN-Drift-Pins + formatDate describes below are pure-logic and CI-stable.
describe("ExportSection", () => {
  test("idle: Intro + Request-Button, Texte übersetzt (keine rohen Keys)", async () => {
    const { view } = renderExportSection({});
    await waitForMount(view);
    expect(view.getByTestId("privacy-export-request")).toBeTruthy();
    expect(view.container.textContent).not.toContain("userDataRights.privacyCenter");
  });

  test("export done: Download-Button + Verfügbar-bis-Datum", async () => {
    const { view } = renderExportSection({
      exportStatus: {
        hasJob: true,
        job: { id: "job-123", status: EXPORT_JOB_STATUS.Done, expiresAt: "2026-07-11T00:00:00Z" },
      },
    });
    await waitForDownloadReady(view);
    expect(view.getByTestId("privacy-export-download")).toBeTruthy();
    const ready = view.getByTestId("privacy-export-ready");
    expect(ready.textContent).toContain("2026-07-11");
    expect(ready.textContent).not.toContain("T00:00");
  });

  test("export failed: Fehler-Banner + Re-Request möglich", async () => {
    const { view } = renderExportSection({
      exportStatus: { hasJob: true, job: { id: "job-9", status: EXPORT_JOB_STATUS.Failed } },
    });
    await waitForTestId(view, "privacy-export-failed");
    expect(view.getByTestId("privacy-export-failed")).toBeTruthy();
    expect(view.getByTestId("privacy-export-request")).toBeTruthy();
  });

  test("export pending: in-progress Banner, kein Request-Button", async () => {
    const { view } = renderExportSection({
      exportStatus: { hasJob: true, job: { id: "job-1", status: EXPORT_JOB_STATUS.Pending } },
    });
    await waitForTestId(view, "privacy-export-pending");
    expect(view.getByTestId("privacy-export-pending")).toBeTruthy();
    expect(view.queryByTestId("privacy-export-request")).toBeNull();
  });

  test("Export-Request dispatcht den korrekten Handler-QN", async () => {
    const { view, writes } = renderExportSection({});
    await waitForMount(view);
    fireEvent.click(view.getByTestId("privacy-export-request"));
    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write dispatched");
    });
    expect(writes[0]?.type).toBe(UserDataRightsHandlers.requestExport);
  });

  test("Download-Button dispatcht downloadByJob mit der korrekten jobId", async () => {
    const { view, queries } = renderExportSection({
      exportStatus: {
        hasJob: true,
        job: { id: "job-123", status: EXPORT_JOB_STATUS.Done, expiresAt: "2026-07-11T00:00:00Z" },
      },
    });
    await waitForDownloadReady(view);
    fireEvent.click(view.getByTestId("privacy-export-download"));
    await waitFor(() => {
      if (!queries.some((q) => q.type === UserDataRightsQueries.downloadByJob)) {
        throw new Error("no downloadByJob query dispatched");
      }
    });
    const download = queries.find((q) => q.type === UserDataRightsQueries.downloadByJob);
    expect(download?.payload).toEqual({ jobId: "job-123" });
  });

  test("Download-Button navigates to the signed URL from downloadByJob", async () => {
    const signedUrl = "https://cdn.test/exports/job-123.zip?sig=abc";
    const assign = spyOn(window.location, "assign").mockImplementation(() => {});
    try {
      const { view } = renderExportSection({
        downloadUrl: signedUrl,
        exportStatus: {
          hasJob: true,
          job: { id: "job-123", status: EXPORT_JOB_STATUS.Done, expiresAt: "2026-07-11T00:00:00Z" },
        },
      });
      await waitForDownloadReady(view);
      fireEvent.click(view.getByTestId("privacy-export-download"));
      await waitFor(() => {
        if (assign.mock.calls.length === 0) throw new Error("location.assign not called");
      });
      expect(assign).toHaveBeenCalledWith(signedUrl);
    } finally {
      assign.mockRestore();
    }
  });

  test("Download-Button does not navigate when downloadByJob returns no url", async () => {
    const assign = spyOn(window.location, "assign").mockImplementation(() => {});
    try {
      const { view } = renderExportSection({
        downloadUrl: undefined,
        exportStatus: {
          hasJob: true,
          job: { id: "job-123", status: EXPORT_JOB_STATUS.Done, expiresAt: "2026-07-11T00:00:00Z" },
        },
      });
      await waitForDownloadReady(view);
      fireEvent.click(view.getByTestId("privacy-export-download"));
      // Banner uses t(i18nKey) — assert the resolved EN copy, not the raw key.
      await waitFor(() => {
        expect(view.container.textContent).toContain("Download unavailable — please try again.");
      });
      expect(assign).not.toHaveBeenCalled();
    } finally {
      assign.mockRestore();
    }
  });
});

describe("QN-Drift-Pins (client-Konstanten vs. Feature-Originale)", () => {
  test("USER_ME_QUERY spiegelt UserQueries.me", () => {
    expect(USER_ME_QUERY).toBe(UserQueries.me);
  });

  test("EXPORT_JOB_STATUS-Mirror deckt sich mit dem Schema-Original", () => {
    expect(EXPORT_JOB_STATUS).toEqual(SCHEMA_EXPORT_JOB_STATUS);
  });
});

describe("formatDate", () => {
  test("ISO instant → date part only (strips time + Z)", () => {
    expect(formatDate("2026-07-11T00:00:00.000Z")).toBe("2026-07-11");
  });

  test("null / undefined / empty → em dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  test("date-only string without time → returned as-is", () => {
    expect(formatDate("2026-07-11")).toBe("2026-07-11");
  });
});
