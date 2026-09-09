// @runtime client
// Change-password and change-email sections for the declarative `profile`
// projectionDetail screen (fw#2312, ../feature.ts). Both keep re-auth flows
// a declarative action can't express, so they stay React `EditExtensionSection`
// components; account deletion moved to declarative fields/actions on the
// screen itself — same split as user-data-rights' privacy-center
// (../../user-data-rights/web/privacy-center-screen.tsx), which this file
// mirrors.

import {
  type ExtensionSectionProps,
  useDispatcher,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthHandlers } from "../../auth-email-password/constants";
import { requestEmailVerification } from "../../auth-email-password/web";
import { UserProfileHandlers } from "../constants";

type SectionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; messageKey: string }
  | { kind: "error"; messageKey: string };

// Dispatcher failures carry an i18nKey only when the handler sets one —
// boundary read with a generic fallback.
function failureKey(error: unknown): string {
  const key = (error as { i18nKey?: unknown } | null)?.i18nKey; // @cast-boundary dispatcher-error
  return typeof key === "string" ? key : "profile.errors.generic";
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
// its own. Deliberately NOT a <Form>: RenderEdit already renders a host
// <form> around the whole singleton screen (render-edit.tsx), so a second
// nested <form> here is invalid DOM and silently degrades the submit button
// into a native GET navigation instead of a write dispatch (same failure
// mode write-form-section.tsx documents and avoids the same way — a plain
// button click, not a second <form>).
export function ChangePasswordSection(): ReactNode {
  const t = useTranslation();
  const { Field, Input, Button } = usePrimitives();
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
    <div data-testid="profile-password" className="flex flex-col gap-4">
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
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit()}
          testId="profile-password-submit"
        >
          {t("profile.password.submit")}
        </Button>
      </div>
    </div>
  );
}

// Mounted by the renderer's ExtensionSectionMount analogous to
// ChangePasswordSection above. `values.email` is the host projectionDetail's
// current `me` row (seeded from the `user:query:user:me` query, ../feature.ts)
// — ExtensionSectionProps carries no refetch hook, so a successful change
// pushes the new address back into the host form via `patch` instead of
// relying on a full-screen refetch to un-stale the "current email" line.
export function ChangeEmailSection({ values, patch }: ExtensionSectionProps): ReactNode {
  const t = useTranslation();
  const { Field, Input, Button, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });

  const currentEmail = typeof values?.["email"] === "string" ? values["email"] : "";

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
      // Verification mail to the new address. The change is already
      // persisted → a send failure must not reverse the success, but it is
      // NOT swallowed (otherwise the user waits for a mail that never
      // arrives). The success message accordingly promises no send.
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
      patch?.({ email: newEmail });
      setNewEmail("");
      setCurrentPassword("");
      setStatus({ kind: "success", messageKey: "profile.email.success" });
    })();
  };

  const submitting = status.kind === "submitting";
  return (
    <div data-testid="profile-email" className="flex flex-col gap-4">
      <Text variant="muted" testId="profile-email-current">
        {t("profile.email.current")}: {currentEmail}
      </Text>
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
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit()}
          testId="profile-email-submit"
        >
          {t("profile.email.submit")}
        </Button>
      </div>
    </div>
  );
}
