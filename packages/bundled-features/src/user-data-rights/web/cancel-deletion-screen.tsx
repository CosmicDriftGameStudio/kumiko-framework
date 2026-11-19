// CancelAccountDeletionScreen — anonymous screen behind the cancel link of the
// deletion-requested mail (a requested account cannot sign in). Reads the token
// from the URL fragment (`#token=…`) and dispatches
// user-data-rights:write:cancel-deletion-by-token on click.
//
// The app mounts this screen at the deletionCancelUrl route via
// makePublicDeletionGate's cancelPath.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { UserDataRightsHandlers } from "./constants.ts";

const CANCEL_BY_TOKEN = UserDataRightsHandlers.cancelDeletionByToken;

type Phase = "idle" | "submitting" | "success" | "missing" | "invalid" | "error";

function readToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

export type CancelAccountDeletionScreenProps = {
  readonly title?: string;
};

export function CancelAccountDeletionScreen({
  title,
}: CancelAccountDeletionScreenProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Button, Banner, Card } = usePrimitives();
  const [token] = useState(readToken);
  const [phase, setPhase] = useState<Phase>(token.length > 0 ? "idle" : "missing");

  const doCancel = async (): Promise<void> => {
    setPhase("submitting");
    try {
      const res = await dispatcher.write(CANCEL_BY_TOKEN, { token });
      setPhase(res.isSuccess ? "success" : "invalid");
    } catch {
      setPhase("error");
    }
  };

  return (
    <Card
      // biome-ignore lint/plugin: narrow centered confirmation card, not a screen container
      className="w-full max-w-sm mx-auto"
      options={{ padded: false }}
      slots={{
        header: (
          <div className="flex flex-col gap-1.5 p-6 pb-4">
            <h1 className="text-xl font-semibold tracking-tight">
              {title ?? t("userDataRights.deletion.cancel.title")}
            </h1>
          </div>
        ),
      }}
    >
      <div className="p-6 pt-0 flex flex-col gap-4">
        {phase === "success" ? (
          <Banner variant="info">
            <p className="font-medium text-foreground">
              {t("userDataRights.deletion.cancel.successTitle")}
            </p>
            <p className="mt-1">{t("userDataRights.deletion.cancel.successBody")}</p>
          </Banner>
        ) : phase === "missing" ? (
          <Banner variant="error">{t("userDataRights.deletion.cancel.missingToken")}</Banner>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("userDataRights.deletion.cancel.intro")}
            </p>
            {phase === "invalid" && (
              <Banner variant="error">{t("userDataRights.deletion.cancel.invalidToken")}</Banner>
            )}
            {phase === "error" && (
              <Banner variant="error">{t("userDataRights.deletion.cancel.error")}</Banner>
            )}
            <Button
              type="button"
              variant="primary"
              loading={phase === "submitting"}
              disabled={phase === "submitting"}
              onClick={() => void doCancel()}
            >
              {phase === "submitting"
                ? t("userDataRights.deletion.cancel.submitting")
                : t("userDataRights.deletion.cancel.submit")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
