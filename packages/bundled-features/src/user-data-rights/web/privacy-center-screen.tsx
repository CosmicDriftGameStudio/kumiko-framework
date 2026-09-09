// @runtime client
// Export section (Art. 20) — the one part of user-data-rights' privacy-center
// screen that stays custom (fw#2312). Registered as an EditExtensionSection
// component (see web/client-plugin.tsx); the projectionDetail screen
// (feature.ts) supplies the surrounding Section chrome (title, testId), so
// this component renders only its own body content.
//
// Export needs async-job polling (worker-Lane-Cron, ~1 Min) plus a
// signed-URL download — logic a declarative field/action can't express.
// Restriction (Art. 18) and Deletion (Art. 17) moved onto the screen's
// declarative fields/actions instead (feature.ts).

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { postWithDownload } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useEffect, useState } from "react";
import {
  EXPORT_JOB_STATUS,
  type ExportJobStatus,
  UserDataRightsHandlers,
  UserDataRightsQueries,
} from "../constants";

// Export-Job läuft async (worker-Lane-Cron, ~1 Min). Solange er pending/running
// ist, pollt der Screen den Status, damit der Download ohne manuellen Reload
// erscheint.
const EXPORT_POLL_MS = 4000;

type ExportJob = {
  readonly id: string;
  readonly status: ExportJobStatus;
  readonly expiresAt?: string | null;
  readonly errorMessage?: string | null;
};
type ExportStatusResult =
  | { readonly hasJob: false }
  | { readonly hasJob: true; readonly job: ExportJob };

type SectionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; messageKey: string }
  | { kind: "error"; messageKey: string };

// Dispatcher-Failures tragen i18nKey nur wenn der Handler einen setzt —
// Boundary-Read mit generischem Fallback.
function failureKey(error: unknown): string {
  const key = (error as { i18nKey?: unknown } | null)?.i18nKey; // @cast-boundary dispatcher-error
  return typeof key === "string" ? key : "userDataRights.privacyCenter.errors.generic";
}

// Roher ISO-Instant → nur der Datums-Teil ist relevant; reiner String-Slice,
// kein Date-API (no-date-api-Guard) und universell. Leer/null → "—".
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const tIndex = iso.indexOf("T");
  return tIndex > 0 ? iso.slice(0, tIndex) : iso;
}

function StatusBanner({ status }: { readonly status: SectionStatus }): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  if (status.kind === "success") {
    return <Banner variant="info">{t(status.messageKey)}</Banner>;
  }
  if (status.kind === "error") {
    return <Banner variant="error">{t(status.messageKey)}</Banner>;
  }
  return null;
}

// Mounted by the renderer's ExtensionSectionMount (already wrapped in
// <Section title={...} testId="section-extension-...">) — takes no props of
// its own, ExtensionSectionProps (entityName/entityId/...) are unused since
// export status/actions are scoped to the current user session, not to a
// host entity row.
export function ExportSection(): ReactNode {
  const t = useTranslation();
  const { Button, Banner } = usePrimitives();
  const dispatcher = useDispatcher();
  const statusQuery = useQuery<ExportStatusResult | null>(UserDataRightsQueries.exportStatus, {});
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });

  const request = async (): Promise<void> => {
    setStatus({ kind: "submitting" });
    const res = await dispatcher.write(UserDataRightsHandlers.requestExport, {});
    if (!res.isSuccess) {
      setStatus({ kind: "error", messageKey: failureKey(res.error) });
      return;
    }
    setStatus({ kind: "idle" });
    void statusQuery.refetch?.();
  };

  // Download laeuft ueber den Dispatcher (traegt X-CSRF-Token) statt ueber
  // eine <a>-Navigation: download-by-job liefert eine signed URL zurueck, auf
  // die postWithDownload den Browser navigiert (content-disposition:
  // attachment → laedt herunter).
  const downloadExport = async (jobId: string): Promise<void> => {
    const err = await postWithDownload(dispatcher, UserDataRightsQueries.downloadByJob, { jobId });
    if (err) setStatus({ kind: "error", messageKey: failureKey(err) });
  };

  const result = statusQuery.data;
  const job = result?.hasJob ? result.job : null;
  const submitting = status.kind === "submitting";
  const inProgress =
    job?.status === EXPORT_JOB_STATUS.Pending || job?.status === EXPORT_JOB_STATUS.Running;
  const done = job?.status === EXPORT_JOB_STATUS.Done;
  const failed = job?.status === EXPORT_JOB_STATUS.Failed;

  // While the job is running: poll until Done/Failed, then auto-stop.
  const refetch = statusQuery.refetch;
  // kumiko-lint-ignore no-raw-hooks Phase-3 conversion tracked in #2312
  useEffect(() => {
    if (!inProgress || !refetch) return;
    const id = setInterval(() => void refetch(), EXPORT_POLL_MS);
    return () => clearInterval(id);
  }, [inProgress, refetch]);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t("userDataRights.privacyCenter.export.intro")}
      </p>
      {statusQuery.error && (
        <Banner variant="error">{t("userDataRights.privacyCenter.errors.generic")}</Banner>
      )}
      {inProgress && (
        <Banner variant="info" testId="privacy-export-pending">
          {t("userDataRights.privacyCenter.export.pending")}
        </Banner>
      )}
      {failed && (
        <Banner variant="error" testId="privacy-export-failed">
          {t("userDataRights.privacyCenter.export.failed")}
        </Banner>
      )}
      {done && job && (
        <Banner variant="info" testId="privacy-export-ready">
          <p className="font-medium text-foreground">
            {t("userDataRights.privacyCenter.export.ready")}
          </p>
          {job.expiresAt && (
            <p className="mt-1">
              {t("userDataRights.privacyCenter.export.availableUntil", {
                date: formatDate(job.expiresAt),
              })}
            </p>
          )}
          <div className="mt-2">
            <Button
              variant="secondary"
              onClick={() => void downloadExport(job.id)}
              testId="privacy-export-download"
            >
              {t("userDataRights.privacyCenter.export.download")}
            </Button>
          </div>
        </Banner>
      )}
      {!inProgress && (
        <div className="mt-2">
          <Button
            onClick={() => void request()}
            disabled={submitting}
            loading={submitting}
            testId="privacy-export-request"
          >
            {done
              ? t("userDataRights.privacyCenter.export.requestNew")
              : submitting
                ? t("userDataRights.privacyCenter.export.requesting")
                : t("userDataRights.privacyCenter.export.request")}
          </Button>
        </div>
      )}
      <StatusBanner status={status} />
    </>
  );
}
