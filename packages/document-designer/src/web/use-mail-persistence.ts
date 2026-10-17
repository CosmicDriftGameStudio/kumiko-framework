// @runtime client
import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useMutation, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";
import { errorTextWithFieldIssues } from "./field-issue-text.js";
import { buildMeta, parseJsonRecord } from "./mail-draft.js";
import type { MailDraft, TemplateRowView, UpsertResponse } from "./mail-types.js";

// "saved-not-published": the system version was written but publishing it failed, so the
// stored state changed and the editor must reload even though an error is shown.
export type SaveOutcome = "saved" | "saved-not-published" | "failed";

export type MailPersistence = {
  readonly save: (draft: MailDraft, publish: boolean) => Promise<SaveOutcome>;
  readonly busy: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
};

// One write for save and publish. The overview title is passed on every write because the
// upsert replaces a missing title with null and find-by-id does not return it.
export function useMailPersistence(args: {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly isSystemAdmin: boolean;
  readonly row: TemplateRowView | null;
}): MailPersistence {
  const t = useTranslation();
  const upsertTenant = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertTenant);
  const upsertSystem = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertSystem);
  const publishSystem = useMutation(TemplateResolverHandlers.publishSystem);
  const [error, setError] = useState<string | null>(null);

  const save = async (draft: MailDraft, publish: boolean): Promise<SaveOutcome> => {
    setError(null);
    const base = {
      slug: args.slug,
      kind: "mail",
      locale: args.locale,
      title: args.title,
      content: draft.body,
      contentFormat: "html",
      meta: buildMeta(draft),
      variableSchema: parseJsonRecord(args.row?.variableSchema),
    };
    const saved = args.isSystemAdmin
      ? await upsertSystem.mutate(base)
      : await upsertTenant.mutate({ ...base, status: publish ? "active" : "draft" });
    if (!saved.isSuccess) {
      setError(errorTextWithFieldIssues(saved.error, t));
      return "failed";
    }
    if (args.isSystemAdmin && publish) {
      const published = await publishSystem.mutate({ id: saved.data.id });
      if (!published.isSuccess) {
        setError(errorTextWithFieldIssues(published.error, t));
        return "saved-not-published";
      }
    }
    return "saved";
  };

  return {
    save,
    busy: upsertTenant.pending || upsertSystem.pending || publishSystem.pending,
    error,
    clearError: () => setError(null),
  };
}
