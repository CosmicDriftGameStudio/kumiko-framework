// Shared body of the anonymous deletion screens (confirm, cancel): reads the token from the URL
// fragment (`#token=…`, never sent to the server, so it stays out of proxy/access logs) and
// dispatches the token handler on click.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";

type Phase = "idle" | "submitting" | "success" | "missing" | "invalid" | "error";

function readToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

export type DeletionTokenScreenCopy = {
  readonly title: string;
  readonly intro: string;
  readonly submit: string;
  readonly submitting: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly invalidToken: string;
  readonly missingToken: string;
  readonly error: string;
};

export type DeletionTokenScreenProps = {
  readonly handler: string;
  readonly copy: DeletionTokenScreenCopy;
  readonly submitVariant: "primary" | "danger";
  readonly title?: string;
};

export function DeletionTokenScreen({
  handler,
  copy,
  submitVariant,
  title,
}: DeletionTokenScreenProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Button, Banner, Card } = usePrimitives();
  const [token] = useState(readToken);
  const [phase, setPhase] = useState<Phase>(token.length > 0 ? "idle" : "missing");

  const submit = async (): Promise<void> => {
    setPhase("submitting");
    try {
      const res = await dispatcher.write(handler, { token });
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
            <h1 className="text-xl font-semibold tracking-tight">{title ?? t(copy.title)}</h1>
          </div>
        ),
      }}
    >
      <div className="p-6 pt-0 flex flex-col gap-4">
        {phase === "success" ? (
          <Banner variant="info">
            <p className="font-medium text-foreground">{t(copy.successTitle)}</p>
            <p className="mt-1">{t(copy.successBody)}</p>
          </Banner>
        ) : phase === "missing" ? (
          <Banner variant="error">{t(copy.missingToken)}</Banner>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t(copy.intro)}</p>
            {phase === "invalid" && <Banner variant="error">{t(copy.invalidToken)}</Banner>}
            {phase === "error" && <Banner variant="error">{t(copy.error)}</Banner>}
            <Button
              type="button"
              variant={submitVariant}
              loading={phase === "submitting"}
              disabled={phase === "submitting"}
              onClick={() => void submit()}
            >
              {phase === "submitting" ? t(copy.submitting) : t(copy.submit)}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
