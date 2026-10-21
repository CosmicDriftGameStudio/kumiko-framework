import { EMPTY_VALUE_PLACEHOLDER } from "@cosmicdrift/kumiko-renderer/headless";
// Export section (Art. 20) — the one part of user-data-rights' privacy-center
// screen that stays custom. Registered as an EditExtensionSection
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
import { postWithDownload } from "@cosmicdrift/kumiko-renderer/web";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useEffect, useState } from "react";
import {
  EXPORT_JOB_STATUS,
  type ExportJobStatus,
  UserDataRightsHandlers,
  UserDataRightsQueries,
} from "./constants.ts";

// The export job runs asynchronously (worker-Lane-Cron, ~1 Min). While it is
// pending/running, the screen polls its status so the download appears without
// a manual reload.
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

// Dispatcher failures include i18nKey only when the handler sets one; read it
// at the boundary with a generic fallback.
function failureKey(error: unknown): string {
  const key = propertyOf(error, "i18nKey");
  return typeof key === "string" ? key : "userDataRights.privacyCenter.errors.generic";
}

// Only the date portion of the raw ISO instant is relevant; use a string slice
// instead of the Date API (no-date-api-Guard) for universal support. Empty/null
// values become "—".
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE_PLACEHOLDER;
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

  // Download runs through the dispatcher (which supplies X-CSRF-Token) instead of
  // an <a>-navigation: download-by-job returns a signed URL, which
  // postWithDownload navigates the browser to (content-disposition:
  // attachment → triggers a download).
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
  // kumiko-lint-ignore no-raw-hooks
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
