import { describe, expect, test } from "bun:test";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";
import {
  accentLineShown,
  appearanceFlags,
  footerMessageOf,
  issueText,
  layoutSaveFlags,
  type SaveLayoutInput,
  saveLayout,
} from "../layout-editor-logic.ts";
import { DEFAULT_LAYOUT_APPEARANCE } from "../layout-meta.ts";
import type { LayoutSourceView, LayoutValidation } from "../layout-types.ts";

const t = (key: string): string => (key === "known.key" ? "Known text" : key);

const failure: DispatcherError = {
  code: "boom",
  httpStatus: 500,
  i18nKey: "unknown.key",
  message: "Server said no",
};

const source: LayoutSourceView = {
  tenant: null,
  system: { id: "sys-1", version: 1, status: "active", locale: "en", contentFormat: "html" },
  regions: { header: "", signature: "", footer: "" },
  effectiveFormat: "html",
  mjmlSource: null,
  meta: DEFAULT_LAYOUT_APPEARANCE,
  locale: "en",
};

const checked = (patch: Partial<LayoutValidation>): LayoutValidation => ({
  canSave: true,
  canPublish: true,
  issues: [],
  publishIssues: [],
  used: [],
  systemPlaceholders: [],
  ...patch,
});

describe("issueText", () => {
  test("uses the translation when the key is known", () => {
    const issue = { path: "p", code: "c", i18nKey: "known.key" };
    expect(issueText(t, issue)).toBe("Known text");
  });

  test("falls back to the code when the key is untranslated", () => {
    const issue = { path: "p", code: "layout_empty", i18nKey: "missing.key" };
    expect(issueText(t, issue)).toBe("layout_empty");
  });
});

describe("footerMessageOf", () => {
  const base = { t, appearanceValid: true, isMail: true, userCount: 2 };

  test("shows nothing before validation ran", () => {
    expect(footerMessageOf({ ...base, checked: null })).toBeNull();
  });

  test("blocks on an invalid appearance before looking at issues", () => {
    const message = footerMessageOf({
      ...base,
      appearanceValid: false,
      checked: checked({ issues: [{ path: "p", code: "c", i18nKey: "k" }] }),
    });
    expect(message).toEqual({
      tone: "bad",
      text: "documentDesigner.appearance.backgroundInvalid",
    });
  });

  test("reports the first save issue, then publish issues", () => {
    const issue = (code: string) => ({ path: "p", code, i18nKey: "k" });
    expect(footerMessageOf({ ...base, checked: checked({ issues: [issue("save")] }) })?.text).toBe(
      "save",
    );
    expect(
      footerMessageOf({ ...base, checked: checked({ publishIssues: [issue("publish")] }) })?.text,
    ).toBe("publish");
  });

  test("reports ok with the mail or pdf wording", () => {
    expect(footerMessageOf({ ...base, checked: checked({}) })?.tone).toBe("ok");
    const mail = footerMessageOf({ ...base, checked: checked({}) })?.text ?? "";
    const pdf = footerMessageOf({ ...base, isMail: false, checked: checked({}) })?.text ?? "";
    expect(mail).toContain("okMail");
    expect(pdf).toContain("okPdf");
  });
});

describe("appearanceFlags", () => {
  const appearance = DEFAULT_LAYOUT_APPEARANCE;

  test("html mail layouts edit the appearance", () => {
    expect(appearanceFlags({ isMail: true, mjmlMode: false, source, appearance })).toEqual({
      appearanceFromMjml: false,
      appearanceEditable: true,
      appearanceValid: true,
    });
  });

  test("mjml, either stored or being edited, takes the look from the source", () => {
    const stored = appearanceFlags({
      isMail: true,
      mjmlMode: false,
      source: { ...source, effectiveFormat: "mjml" },
      appearance,
    });
    const editing = appearanceFlags({ isMail: true, mjmlMode: true, source, appearance });
    expect(stored.appearanceEditable).toBe(false);
    expect(editing.appearanceEditable).toBe(false);
    expect(stored.appearanceValid).toBe(true);
  });

  test("pdf layouts never edit the appearance", () => {
    expect(
      appearanceFlags({ isMail: false, mjmlMode: false, source, appearance }).appearanceEditable,
    ).toBe(false);
  });

  test("an invalid background only counts while the appearance is editable", () => {
    const bad = { ...appearance, outerBackground: "red" };
    expect(
      appearanceFlags({ isMail: true, mjmlMode: false, source, appearance: bad }).appearanceValid,
    ).toBe(false);
    expect(
      appearanceFlags({ isMail: false, mjmlMode: false, source, appearance: bad }).appearanceValid,
    ).toBe(true);
  });
});

describe("accentLineShown", () => {
  const input = {
    isMail: true,
    appearanceEditable: true,
    appearance: { ...DEFAULT_LAYOUT_APPEARANCE, accentLine: "branding" as const },
    accentColor: "#112233",
  };

  test("shows the line for an editable mail layout with a branding accent", () => {
    expect(accentLineShown(input)).toBe(true);
  });

  test.each([
    ["not a mail", { isMail: false }],
    ["not editable", { appearanceEditable: false }],
    ["no branding line", { appearance: DEFAULT_LAYOUT_APPEARANCE }],
    ["no hex accent", { accentColor: "teal" }],
  ])("hides the line when %s", (_name, patch) => {
    expect(accentLineShown({ ...input, ...patch })).toBe(false);
  });
});

describe("layoutSaveFlags", () => {
  const base = {
    dirty: true,
    checked: checked({}),
    appearanceValid: true,
    busy: false,
    shownRow: null,
  };

  test("saving needs unsaved edits, a valid check, a valid appearance and no running save", () => {
    expect(layoutSaveFlags(base).canSave).toBe(true);
    expect(layoutSaveFlags({ ...base, dirty: false }).canSave).toBe(false);
    expect(layoutSaveFlags({ ...base, checked: checked({ canSave: false }) }).canSave).toBe(false);
    expect(layoutSaveFlags({ ...base, checked: null }).canSave).toBe(false);
    expect(layoutSaveFlags({ ...base, appearanceValid: false }).canSave).toBe(false);
    expect(layoutSaveFlags({ ...base, busy: true }).canSave).toBe(false);
  });

  test("publishing is possible for a clean draft row but not for a clean active row", () => {
    const row = (status: string) => ({ id: "r", version: 1, status, locale: "en" });
    const clean = { ...base, dirty: false };
    expect(layoutSaveFlags({ ...clean, shownRow: row("draft") }).canPublish).toBe(true);
    expect(layoutSaveFlags({ ...clean, shownRow: row("active") }).canPublish).toBe(false);
    expect(layoutSaveFlags({ ...clean, shownRow: null }).canPublish).toBe(false);
    expect(layoutSaveFlags({ ...base, shownRow: row("active") }).canPublish).toBe(true);
  });

  test("publishing is blocked by a failing publish check or a running save", () => {
    expect(layoutSaveFlags({ ...base, checked: checked({ canPublish: false }) }).canPublish).toBe(
      false,
    );
    expect(layoutSaveFlags({ ...base, busy: true }).canPublish).toBe(false);
  });
});

type Recorded = { readonly name: string; readonly payload: unknown };

function saveHarness(options: {
  readonly isSystemAdmin: boolean;
  readonly publish: boolean;
  readonly upsertFails?: boolean;
  readonly publishFails?: boolean;
}) {
  const calls: Recorded[] = [];
  const errors: Array<string | null> = [];
  let reloads = 0;
  const mutation = (name: string, fails: boolean | undefined) => ({
    mutate: async (payload: unknown) => {
      calls.push({ name, payload });
      return fails === true
        ? { isSuccess: false as const, error: failure }
        : { isSuccess: true as const, data: { id: "saved-1" } };
    },
  });
  // Boundary cast: the save flow only calls `mutate` on the mutation handles.
  const input = {
    publish: options.publish,
    kind: "mail-layout",
    slug: "default",
    source,
    content: "<p>body</p>",
    mjmlMode: false,
    isMail: true,
    isSystemAdmin: options.isSystemAdmin,
    appearanceEditable: false,
    appearance: DEFAULT_LAYOUT_APPEARANCE,
    t,
    upsertTenant: mutation("upsertTenant", options.upsertFails),
    upsertSystem: mutation("upsertSystem", options.upsertFails),
    publishSystem: mutation("publishSystem", options.publishFails),
    setSaveError: (message: string | null) => errors.push(message),
    onReload: async () => {
      reloads += 1;
    },
  } as unknown as SaveLayoutInput;
  return { input, calls, errors, reloads: () => reloads };
}

describe("saveLayout", () => {
  test("a tenant saves a draft or an active row depending on publish", async () => {
    const draft = saveHarness({ isSystemAdmin: false, publish: false });
    await saveLayout(draft.input);
    const active = saveHarness({ isSystemAdmin: false, publish: true });
    await saveLayout(active.input);
    expect(draft.calls.map((call) => call.name)).toEqual(["upsertTenant"]);
    expect(draft.calls[0]?.payload).toMatchObject({ status: "draft", contentFormat: "html" });
    expect(active.calls[0]?.payload).toMatchObject({ status: "active" });
    expect(active.calls.map((call) => call.name)).toEqual(["upsertTenant"]);
    expect(draft.reloads()).toBe(1);
    expect(draft.errors).toEqual([null]);
  });

  test("a system admin saves without publishing", async () => {
    const run = saveHarness({ isSystemAdmin: true, publish: false });
    await saveLayout(run.input);
    expect(run.calls.map((call) => call.name)).toEqual(["upsertSystem"]);
    expect(run.reloads()).toBe(1);
  });

  test("a system admin publishes the saved row", async () => {
    const run = saveHarness({ isSystemAdmin: true, publish: true });
    await saveLayout(run.input);
    expect(run.calls.map((call) => call.name)).toEqual(["upsertSystem", "publishSystem"]);
    expect(run.calls[1]?.payload).toEqual({ id: "saved-1" });
    expect(run.reloads()).toBe(1);
  });

  test("a failed save shows the error and neither publishes nor reloads", async () => {
    const run = saveHarness({ isSystemAdmin: true, publish: true, upsertFails: true });
    await saveLayout(run.input);
    expect(run.calls.map((call) => call.name)).toEqual(["upsertSystem"]);
    expect(run.errors).toEqual([null, "Server said no"]);
    expect(run.reloads()).toBe(0);
  });

  test("a failed publish shows the error and does not reload", async () => {
    const run = saveHarness({ isSystemAdmin: true, publish: true, publishFails: true });
    await saveLayout(run.input);
    expect(run.errors).toEqual([null, "Server said no"]);
    expect(run.reloads()).toBe(0);
  });
});
