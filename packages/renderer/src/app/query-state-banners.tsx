import type { DispatcherError, Translate } from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n.js";
import { usePrimitives } from "../primitives.js";
import { dispatcherErrorText } from "./write-failed-error.js";

export function QueryLoadingBanner(): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  return (
    <Banner padded variant="loading" testId="kumiko-screen-loading">
      {t("kumiko.widget.loading")}
    </Banner>
  );
}

export function QueryErrorBanner({
  error,
  translate,
  onRetry,
}: {
  readonly error: DispatcherError;
  readonly translate: Translate;
  readonly onRetry: () => void | Promise<void>;
}): ReactNode {
  const { Banner, Button } = usePrimitives();
  const t = useTranslation();
  return (
    <Banner
      padded
      variant="error"
      testId="kumiko-screen-error"
      actions={
        <Button variant="secondary" size="sm" onClick={onRetry} testId="kumiko-screen-retry">
          {t("kumiko.actions.retry")}
        </Button>
      }
    >
      {dispatcherErrorText(error, translate)}
    </Banner>
  );
}
