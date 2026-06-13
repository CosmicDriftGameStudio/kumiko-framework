// @runtime client
// ConfirmAccountDeletionScreen — anonymer Apex-Screen Schritt 2. Liest das
// `?token` aus der Verify-Link-URL und dispatcht beim Bestätigen
// user-data-rights:write:confirm-deletion-by-token → startet die Grace-Period.
//
// App mountet den Screen unter der deletionVerifyUrl-Route (z.B.
// /delete-account/confirm) via createPublicSurface.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";

const CONFIRM_BY_TOKEN = "user-data-rights:write:confirm-deletion-by-token";

type Phase = "idle" | "submitting" | "success" | "missing" | "invalid";

function readToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export type ConfirmAccountDeletionScreenProps = {
  readonly title?: string;
};

export function ConfirmAccountDeletionScreen({
  title,
}: ConfirmAccountDeletionScreenProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Button, Banner } = usePrimitives();
  const [token] = useState(readToken);
  const [phase, setPhase] = useState<Phase>(token.length > 0 ? "idle" : "missing");

  const doConfirm = async (): Promise<void> => {
    setPhase("submitting");
    try {
      const res = await dispatcher.write(CONFIRM_BY_TOKEN, { token });
      setPhase(res.isSuccess ? "success" : "invalid");
    } catch {
      setPhase("invalid");
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col space-y-1.5 p-6 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          {title ?? t("userDataRights.deletion.confirm.title")}
        </h1>
      </div>
      <div className="p-6 pt-0 flex flex-col gap-4">
        {phase === "success" ? (
          <Banner variant="info">
            <p className="font-medium text-foreground">
              {t("userDataRights.deletion.confirm.successTitle")}
            </p>
            <p className="mt-1">{t("userDataRights.deletion.confirm.successBody")}</p>
          </Banner>
        ) : phase === "missing" ? (
          <Banner variant="error">{t("userDataRights.deletion.confirm.missingToken")}</Banner>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("userDataRights.deletion.confirm.intro")}
            </p>
            {phase === "invalid" && (
              <Banner variant="error">{t("userDataRights.deletion.confirm.invalidToken")}</Banner>
            )}
            <Button
              type="button"
              variant="danger"
              loading={phase === "submitting"}
              disabled={phase === "submitting"}
              onClick={() => void doConfirm()}
            >
              {phase === "submitting"
                ? t("userDataRights.deletion.confirm.submitting")
                : t("userDataRights.deletion.confirm.submit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
