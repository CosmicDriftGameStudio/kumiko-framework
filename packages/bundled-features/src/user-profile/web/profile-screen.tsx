// @runtime client
// ProfileScreen — Self-Service-Kontoseite: Passwort ändern, E-Mail
// ändern (mit Re-Auth + anschließendem Verification-Mail-Trigger),
// Konto löschen / Löschung abbrechen (user-data-rights Grace-Period).
// Apps registrieren die Komponente als custom-Screen:
//   r.screen({ id: "profile", type: "custom",
//     renderer: { react: { __component: "UserProfileScreen" } } })

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthHandlers } from "../../auth-email-password/constants";
import { requestEmailVerification } from "../../auth-email-password/web";
import { UserDataRightsHandlers, UserProfileHandlers, UserProfileQueries } from "../constants";

type MeRow = {
  readonly id: string;
  readonly email: string;
  readonly status?: string;
  readonly gracePeriodEnd?: string | null;
};

type SectionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; messageKey: string }
  | { kind: "error"; messageKey: string };

// Dispatcher-Failures tragen i18nKey nur wenn der Handler einen setzt —
// Boundary-Read mit generischem Fallback.
function failureKey(error: unknown): string {
  const key = (error as { i18nKey?: unknown } | null)?.i18nKey; // @cast-boundary dispatcher-error
  return typeof key === "string" ? key : "profile.errors.generic";
}

// Date-only slice of the raw ISO instant — the time/Z part is noise to the user.
// Pure string-slice: no Date API (no-date-api guard), universal (RN+Web). Empty → "—".
export function formatDeletionDate(iso: string | null | undefined): string {
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

function ChangePasswordSection(): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button } = usePrimitives();
  const dispatcher = useDispatcher();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });

  const onSubmit = (): void => {
    void (async () => {
      if (newPassword !== confirm) {
        setStatus({ kind: "error", messageKey: "profile.password.mismatch" });
        return;
      }
      setStatus({ kind: "submitting" });
      const res = await dispatcher.write(AuthHandlers.changePassword, {
        oldPassword,
        newPassword,
      });
      if (!res.isSuccess) {
        setStatus({ kind: "error", messageKey: failureKey(res.error) });
        return;
      }
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      setStatus({ kind: "success", messageKey: "profile.password.success" });
    })();
  };

  const submitting = status.kind === "submitting";
  return (
    <Form
      testId="profile-password"
      title={t("profile.password.title")}
      onSubmit={onSubmit}
      actions={
        <Button type="submit" disabled={submitting} testId="profile-password-submit">
          {t("profile.password.submit")}
        </Button>
      }
    >
      <Field id="profile-old-password" label={t("profile.password.old")} required>
        <Input
          kind="password"
          id="profile-old-password"
          name="profile-old-password"
          value={oldPassword}
          onChange={setOldPassword}
          disabled={submitting}
          required
          autoComplete="current-password"
        />
      </Field>
      <Field id="profile-new-password" label={t("profile.password.new")} required>
        <Input
          kind="password"
          id="profile-new-password"
          name="profile-new-password"
          value={newPassword}
          onChange={setNewPassword}
          disabled={submitting}
          required
          autoComplete="new-password"
        />
      </Field>
      <Field id="profile-confirm-password" label={t("profile.password.confirm")} required>
        <Input
          kind="password"
          id="profile-confirm-password"
          name="profile-confirm-password"
          value={confirm}
          onChange={setConfirm}
          disabled={submitting}
          required
          autoComplete="new-password"
        />
      </Field>
      <StatusBanner status={status} />
    </Form>
  );
}

function ChangeEmailSection({
  me,
  onChanged,
}: {
  readonly me: MeRow;
  readonly onChanged: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button } = usePrimitives();
  const dispatcher = useDispatcher();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });

  const onSubmit = (): void => {
    void (async () => {
      setStatus({ kind: "submitting" });
      const res = await dispatcher.write(UserProfileHandlers.changeEmail, {
        currentPassword,
        newEmail,
      });
      if (!res.isSuccess) {
        setStatus({ kind: "error", messageKey: failureKey(res.error) });
        return;
      }
      // Verification-Mail an die neue Adresse. Der Wechsel ist bereits
      // persistiert → ein Versand-Fehler darf den Erfolg nicht umkehren, wird
      // aber NICHT verschluckt (sonst wartet der User auf eine Mail, die nie
      // kommt). Die Success-Message verspricht entsprechend keinen Versand.
      try {
        const verification = await requestEmailVerification(newEmail);
        if (!verification.ok) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for verification-send-failure
          console.warn(
            "[user-profile] email changed but the verification email could not be sent to the new address.",
          );
        }
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: operator-visibility for verification-send-failure
        console.warn(
          `[user-profile] email changed but the verification email send threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      setNewEmail("");
      setCurrentPassword("");
      setStatus({ kind: "success", messageKey: "profile.email.success" });
      onChanged();
    })();
  };

  const submitting = status.kind === "submitting";
  return (
    <Form
      testId="profile-email"
      title={t("profile.email.title")}
      onSubmit={onSubmit}
      subtitle={
        <span data-testid="profile-email-current">
          {t("profile.email.current")}: {me.email}
        </span>
      }
      actions={
        <Button type="submit" disabled={submitting} testId="profile-email-submit">
          {t("profile.email.submit")}
        </Button>
      }
    >
      <Field id="profile-new-email" label={t("profile.email.new")} required>
        <Input
          kind="email"
          id="profile-new-email"
          name="profile-new-email"
          value={newEmail}
          onChange={setNewEmail}
          disabled={submitting}
          required
          autoComplete="email"
        />
      </Field>
      <Field id="profile-email-password" label={t("profile.email.currentPassword")} required>
        <Input
          kind="password"
          id="profile-email-password"
          name="profile-email-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          disabled={submitting}
          required
          autoComplete="current-password"
        />
      </Field>
      <StatusBanner status={status} />
    </Form>
  );
}

function DangerZoneSection({
  me,
  onChanged,
}: {
  readonly me: MeRow;
  readonly onChanged: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Banner, Dialog, Card } = usePrimitives();
  // Card.slots.title always renders <h3> — with the page's <h1> (variant="page")
  // as this screen's only other heading, that skips <h2> (607/4). An explicit
  // header slot with a real <h2> keeps the levels contiguous; layout mirrors
  // DefaultCard's own default-header markup.
  const dangerZoneHeader = (
    <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-4">
      <h2 className="text-base font-semibold leading-none tracking-tight">
        {t("profile.danger.title")}
      </h2>
    </div>
  );
  const dispatcher = useDispatcher();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });

  const deletionRequested = me.status === "deletionRequested";

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
    setStatus({ kind: "success", messageKey: "profile.danger.cancelSuccess" });
    onChanged();
  };

  const footer = deletionRequested ? (
    <Button
      variant="secondary"
      onClick={() => void cancelDeletion()}
      testId="profile-danger-cancel"
    >
      {t("profile.danger.cancelDeletion")}
    </Button>
  ) : (
    <Button variant="danger" onClick={() => setDialogOpen(true)} testId="profile-danger-delete">
      {t("profile.danger.delete")}
    </Button>
  );

  return (
    <Card
      testId="profile-danger"
      className="border-destructive/40"
      slots={{ header: dangerZoneHeader, footer }}
    >
      <div className="flex flex-col gap-4">
        {deletionRequested ? (
          <>
            <Banner variant="error" testId="profile-danger-requested">
              {t("profile.danger.requested", {
                date: formatDeletionDate(me.gracePeriodEnd),
              })}
            </Banner>
            <StatusBanner status={status} />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("profile.danger.explainer")}</p>
            <StatusBanner status={status} />
            <Dialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              title={t("profile.danger.dialogTitle")}
              description={t("profile.danger.dialogDescription")}
              variant="danger"
              confirmLabel={t("profile.danger.delete")}
              onConfirm={requestDeletion}
              testId="profile-danger-dialog"
            />
          </>
        )}
      </div>
    </Card>
  );
}

export function ProfileScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Heading } = usePrimitives();
  const meQuery = useQuery<MeRow | null>(UserProfileQueries.me, {});

  if (meQuery.error) {
    return (
      <Banner padded variant="error" testId="profile-error">
        {meQuery.error.i18nKey}
      </Banner>
    );
  }
  const me = meQuery.data;
  if (me === null || me === undefined) {
    return (
      <Banner padded variant="loading" testId="profile-loading">
        Loading…
      </Banner>
    );
  }

  const refetch = (): void => {
    void meQuery.refetch?.();
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6 p-6" data-testid="profile-screen">
      <Heading variant="page">{t("profile.title")}</Heading>
      {/* Die zwei kurzen Konto-Forms teilen sich eine Reihe (md+); die
          Danger-Zone bleibt volle Breite darunter. */}
      <div className="grid items-start gap-6 md:grid-cols-2">
        <ChangeEmailSection me={me} onChanged={refetch} />
        <ChangePasswordSection />
      </div>
      <DangerZoneSection me={me} onChanged={refetch} />
    </div>
  );
}
