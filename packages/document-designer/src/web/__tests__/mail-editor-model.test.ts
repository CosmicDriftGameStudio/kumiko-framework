import { describe, expect, test } from "bun:test";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";
import type { MailEditorBodyProps } from "../mail-editor-logic.ts";
import { buildMailModel, type MailModelInput } from "../mail-editor-model.ts";
import type { MailDraft, TemplateRowView } from "../mail-types.ts";

const draft: MailDraft = {
  subject: "Hello",
  previewText: "",
  layoutSlug: "default",
  category: "",
  senderName: "",
  replyTo: "",
  headerChip: "",
  tone: "",
  footerNote: "",
  body: "<p>Hi</p>",
};

const failure: DispatcherError = {
  code: "nope",
  httpStatus: 400,
  i18nKey: "unknown.key",
  message: "Removal refused",
};

const tenantRow: TemplateRowView = {
  id: "row-1",
  version: 3,
  slug: "invoice",
  locale: "en",
  scope: "tenant",
  status: "active",
  content: "",
  variableSchema: {},
  linkedResources: {
    logo: "file-1",
    terms: { kind: "file", fileRefId: "file-2", fileName: "t.pdf" },
  },
  meta: {},
  modifiedAt: null,
};

type Options = {
  readonly dirty?: boolean;
  readonly row?: TemplateRowView | null;
  readonly saveResult?: "saved" | "failed" | "noop";
  readonly removeFails?: boolean;
};

function harness(options: Options = {}) {
  const log: string[] = [];
  const dialogs: unknown[] = [];
  const resourceErrors: Array<string | null> = [];
  const settled: MailDraft[] = [];
  const removed: unknown[] = [];
  const sent: unknown[] = [];
  const row = options.row === undefined ? tenantRow : options.row;
  // Boundary casts: the model only touches the members faked here.
  const props = {
    slug: "invoice",
    locale: "en",
    row,
    onLocaleChange: (locale: string) => log.push(`locale:${locale}`),
    onReload: async () => {
      log.push("reload");
    },
    onRefreshRow: async () => {
      log.push("refresh");
    },
  } as unknown as MailEditorBodyProps;
  const ui = {
    draft,
    baseline: draft,
    creating: false,
    mode: "edit",
    includeAttachments: false,
    prefixSubject: true,
    settle: (next: MailDraft) => settled.push(next),
    setDraft: (next: MailDraft) => log.push(`draft:${next.subject}`),
    setEditorEpoch: () => log.push("epoch"),
    setDialog: (dialog: unknown) => dialogs.push(dialog),
    setResourceError: (message: string | null) => resourceErrors.push(message),
  } as unknown as MailModelInput["ui"];
  const services = {
    persistence: {
      busy: false,
      clearError: () => log.push("clearError"),
      save: async (_draft: MailDraft, publish: boolean) => {
        log.push(`save:${publish}`);
        return options.saveResult ?? "saved";
      },
    },
    resourceRemove: {
      mutate: async (payload: unknown) => {
        removed.push(payload);
        return options.removeFails === true
          ? { isSuccess: false as const, error: failure }
          : { isSuccess: true as const, data: undefined };
      },
    },
    testMail: {
      send: async (payload: unknown) => sent.push(payload),
      availability: { canSend: true },
    },
    pdfTemplates: { rows: [] },
  } as unknown as MailModelInput["services"];
  const model = buildMailModel({
    props,
    t: (key) => key,
    ui,
    picked: null,
    setPicked: () => {},
    services,
    validation: null,
    variableSchema: { v: 1 },
    pickedVariables: null,
    locked: false,
    dirty: options.dirty ?? false,
  });
  return { model, log, dialogs, resourceErrors, settled, removed, sent };
}

describe("buildMailModel actions", () => {
  test("update merges the patch, stores it and settles the preview", () => {
    const { model, log, settled } = harness();
    model.update({ subject: "Changed" });
    expect(log).toEqual(["draft:Changed"]);
    expect(settled[0]).toEqual({ ...draft, subject: "Changed" });
  });

  test("reset restores the baseline and clears the save error", () => {
    const { model, log, settled } = harness();
    model.reset();
    expect(log).toEqual(["draft:Hello", "epoch", "clearError"]);
    expect(settled).toEqual([draft]);
  });

  test("save reloads the template list unless the save failed", async () => {
    const ok = harness();
    await ok.model.saveAndReload(true);
    expect(ok.log).toEqual(["save:true", "reload"]);

    const failed = harness({ saveResult: "failed" });
    await failed.model.saveAndReload(false);
    expect(failed.log).toEqual(["save:false"]);
  });
});

describe("buildMailModel leaving a language", () => {
  test("stays put when the target language is already open", () => {
    const { model, log, dialogs } = harness({ dirty: true });
    model.leave({ kind: "locale", locale: "en" });
    expect(log).toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test("switches directly when nothing is unsaved", () => {
    const { model, log, dialogs } = harness({ dirty: false });
    model.leave({ kind: "locale", locale: "de" });
    expect(log).toEqual(["locale:de"]);
    expect(dialogs).toEqual([]);
  });

  test("asks first when there are unsaved edits", () => {
    const { model, log, dialogs } = harness({ dirty: true });
    model.leave({ kind: "locale", locale: "de" });
    expect(log).toEqual([]);
    expect(dialogs).toEqual([{ kind: "leave", target: { kind: "locale", locale: "de" } }]);
  });

  test("save-and-leave switches only after a successful save", async () => {
    const saved = harness({ saveResult: "saved" });
    await saved.model.leaveSave({ kind: "locale", locale: "de" });
    expect(saved.log).toEqual(["save:false", "locale:de"]);

    const failed = harness({ saveResult: "failed" });
    await failed.model.leaveSave({ kind: "locale", locale: "de" });
    expect(failed.log).toEqual(["save:false"]);
  });
});

describe("buildMailModel resources", () => {
  test("splits linked resources into previews, taken keys and attachments", () => {
    const { model } = harness();
    expect(model.takenKeys).toEqual(["logo", "terms"]);
    expect(Object.keys(model.resourcePreviews)).toEqual(["logo"]);
    expect(model.attachments.map((resource) => resource.key)).toEqual(["terms"]);
    expect(model.uploadTemplateId).toBe("row-1");
  });

  test("removing refreshes the row and clears the previous error", async () => {
    const { model, removed, resourceErrors, log } = harness();
    await model.removeResource("logo");
    expect(removed).toEqual([{ templateId: "row-1", key: "logo" }]);
    expect(resourceErrors).toEqual([null]);
    expect(log).toEqual(["refresh"]);
  });

  test("a refused removal shows the error and does not refresh", async () => {
    const { model, resourceErrors, log } = harness({ removeFails: true });
    await model.removeResource("logo");
    expect(resourceErrors).toEqual([null, "Removal refused"]);
    expect(log).toEqual([]);
  });

  test("system rows own no removable resources", async () => {
    const { model, removed } = harness({ row: { ...tenantRow, scope: "system" } });
    expect(model.uploadTemplateId).toBeNull();
    await model.removeResource("logo");
    expect(removed).toEqual([]);
  });

  test("sending a test mail uses the draft, schema and picked options", () => {
    const { model, sent } = harness();
    model.sendTestMail();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      slug: "invoice",
      locale: "en",
      content: "<p>Hi</p>",
      variableSchema: { v: 1 },
      includeAttachments: false,
      prefixSubject: true,
    });
  });
});
