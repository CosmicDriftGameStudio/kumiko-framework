// @runtime client
// PrivacyCenterScreen — eingeloggte DSGVO-Self-Service-Seite: Datenexport
// (Art. 20), Verarbeitung einschränken (Art. 18) und Konto löschen (Art. 17)
// in einem Screen. Das Feature registriert ihn dormant als custom-Screen
// (r.screen, kein r.nav); die App platziert ihn via r.nav im eingeloggten
// Bereich.
//
// `showDeletion=false` blendet die Lösch-Sektion aus — für Apps, die die
// Konto-Löschung bereits an anderer Stelle anbieten (z.B. Profil-DangerZone),
// damit sie nicht doppelt erscheint.
//
// Art. 18 Lift ist hier bewusst NICHT actionbar: ein eingeschränktes Konto ist
// vom Login geblockt und erreicht diesen Screen gar nicht erst — das Aufheben
// läuft über Support / Magic-Link, nicht über die Self-Service-UI.

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell, postWithDownload } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useEffect, useState } from "react";
import {
  EXPORT_JOB_STATUS,
  type ExportJobStatus,
  USER_ME_QUERY,
  UserDataRightsHandlers,
  UserDataRightsQueries,
} from "../constants";

const STATUS_DELETION_REQUESTED = "deletionRequested";
const STATUS_RESTRICTED = "restricted";
// Export-Job läuft async (worker-Lane-Cron, ~1 Min). Solange er pending/running
// ist, pollt der Screen den Status, damit der Download ohne manuellen Reload
// erscheint.
const EXPORT_POLL_MS = 4000;

type MeRow = {
  readonly id: string;
  readonly email: string;
  readonly status?: string;
  readonly gracePeriodEnd?: string | null;
};

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

function ExportSection(): ReactNode {
  const t = useTranslation();
  const { Section, Button, Banner } = usePrimitives();
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

  // Solange der Job läuft: pollen bis Done/Failed, dann auto-Stop.
  const refetch = statusQuery.refetch;
  useEffect(() => {
    if (!inProgress || !refetch) return;
    const id = setInterval(() => void refetch(), EXPORT_POLL_MS);
    return () => clearInterval(id);
  }, [inProgress, refetch]);

  return (
    <Section
      title={t("userDataRights.privacyCenter.export.title")}
      testId="privacy-export"
      actions={
        !inProgress ? (
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
        ) : undefined
      }
    >
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
      <StatusBanner status={status} />
    </Section>
  );
}

function RestrictionSection({
  me,
  onChanged,
}: {
  readonly me: MeRow;
  readonly onChanged: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Section, Button, Banner, Dialog } = usePrimitives();
  const dispatcher = useDispatcher();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });
  const restricted = me.status === STATUS_RESTRICTED;

  // Erfolg ⇒ alle Sessions revoked, der User wird abgemeldet. onChanged ist
  // best-effort (das anschließende Refetch läuft typisch in 401 + Logout-
  // Redirect der App-Auth-Schicht).
  const restrict = async (): Promise<void> => {
    const res = await dispatcher.write(UserDataRightsHandlers.restrictAccount, {});
    if (!res.isSuccess) {
      setStatus({ kind: "error", messageKey: failureKey(res.error) });
      return;
    }
    onChanged();
  };

  return (
    <Section
      title={t("userDataRights.privacyCenter.restriction.title")}
      testId="privacy-restriction"
      variant="destructive"
      actions={
        restricted ? undefined : (
          <Button
            variant="danger"
            onClick={() => setDialogOpen(true)}
            testId="privacy-restriction-restrict"
          >
            {t("userDataRights.privacyCenter.restriction.restrict")}
          </Button>
        )
      }
    >
      {restricted ? (
        <Banner variant="error" testId="privacy-restriction-active">
          {t("userDataRights.privacyCenter.restriction.restricted")}
        </Banner>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("userDataRights.privacyCenter.restriction.explainer")}
          </p>
          <StatusBanner status={status} />
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title={t("userDataRights.privacyCenter.restriction.dialogTitle")}
            description={t("userDataRights.privacyCenter.restriction.dialogDescription")}
            variant="danger"
            confirmLabel={t("userDataRights.privacyCenter.restriction.restrict")}
            onConfirm={restrict}
            testId="privacy-restriction-dialog"
          />
        </>
      )}
    </Section>
  );
}

function DeletionSection({
  me,
  onChanged,
}: {
  readonly me: MeRow;
  readonly onChanged: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Section, Button, Banner, Dialog } = usePrimitives();
  const dispatcher = useDispatcher();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });
  const deletionRequested = me.status === STATUS_DELETION_REQUESTED;

  const requestDeletion = async (): Promise<void> => {
    const res = await dispatcher.write(UserDataRightsHandlers.requestDeletion, {});
    if (!res.isSuccess) {
      setStatus({ kind: "error", messageKey: failureKey(res.error) });
      return;
    }
    setStatus({ kind: "idle" });
    onChanged();
  };

  const cancelDeletion = async (): Promise<void> => {
    const res = await dispatcher.write(UserDataRightsHandlers.cancelDeletion, {});
    if (!res.isSuccess) {
      setStatus({ kind: "error", messageKey: failureKey(res.error) });
      return;
    }
    setStatus({
      kind: "success",
      messageKey: "userDataRights.privacyCenter.deletion.cancelSuccess",
    });
    onChanged();
  };

  return (
    <Section
      title={t("userDataRights.privacyCenter.deletion.title")}
      testId="privacy-deletion"
      variant="destructive"
      actions={
        deletionRequested ? (
          <Button
            variant="secondary"
            onClick={() => void cancelDeletion()}
            testId="privacy-deletion-cancel"
          >
            {t("userDataRights.privacyCenter.deletion.cancel")}
          </Button>
        ) : (
          <Button
            variant="danger"
            onClick={() => setDialogOpen(true)}
            testId="privacy-deletion-delete"
          >
            {t("userDataRights.privacyCenter.deletion.delete")}
          </Button>
        )
      }
    >
      {deletionRequested ? (
        <>
          <Banner variant="error" testId="privacy-deletion-requested">
            {t("userDataRights.privacyCenter.deletion.requested", {
              date: formatDate(me.gracePeriodEnd),
            })}
          </Banner>
          <StatusBanner status={status} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("userDataRights.privacyCenter.deletion.explainer")}
          </p>
          <StatusBanner status={status} />
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title={t("userDataRights.privacyCenter.deletion.dialogTitle")}
            description={t("userDataRights.privacyCenter.deletion.dialogDescription")}
            variant="danger"
            confirmLabel={t("userDataRights.privacyCenter.deletion.delete")}
            onConfirm={requestDeletion}
            testId="privacy-deletion-dialog"
          />
        </>
      )}
    </Section>
  );
}

export function PrivacyCenterScreen({
  showDeletion = true,
}: {
  readonly showDeletion?: boolean;
} = {}): ReactNode {
  const t = useTranslation();
  const { Banner, Heading } = usePrimitives();
  const meQuery = useQuery<MeRow | null>(USER_ME_QUERY, {});

  if (meQuery.error) {
    return (
      <Banner padded variant="error" testId="privacy-error">
        {t("userDataRights.privacyCenter.loadError")}
      </Banner>
    );
  }
  const me = meQuery.data;
  if (me === null || me === undefined) {
    return (
      <Banner padded variant="loading" testId="privacy-loading">
        {t("userDataRights.privacyCenter.loading")}
      </Banner>
    );
  }

  const refetch = (): void => {
    void meQuery.refetch?.();
  };

  return (
    <FormScreenShell className="flex flex-col gap-6" testId="privacy-center-screen">
      <Heading variant="page">{t("userDataRights.privacyCenter.title")}</Heading>
      <p className="text-sm text-muted-foreground">{t("userDataRights.privacyCenter.intro")}</p>
      <ExportSection />
      <RestrictionSection me={me} onChanged={refetch} />
      {showDeletion && <DeletionSection me={me} onChanged={refetch} />}
    </FormScreenShell>
  );
}
