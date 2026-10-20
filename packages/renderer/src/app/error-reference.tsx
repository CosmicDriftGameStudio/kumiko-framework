import type { ReactNode } from "react";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { WriteFailedError } from "./write-failed-error.ts";

/** An error message plus the server request id support needs to find the log line. */
export type ErrorNotice = {
  readonly message: string;
  readonly requestId?: string;
};

export function errorNoticeOf(error: unknown): ErrorNotice {
  if (error instanceof WriteFailedError) {
    const { requestId } = error.dispatcherError;
    return { message: error.message, ...(requestId !== undefined && { requestId }) };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export function ErrorReference({
  requestId,
  testId = "error-reference",
}: {
  readonly requestId: string | undefined;
  readonly testId?: string;
}): ReactNode {
  const { Grid, Text, CopyButton } = usePrimitives();
  const t = useTranslation();
  if (requestId === undefined || requestId === "") return null;
  return (
    <Grid columns="auto">
      <Text variant="small" testId={`${testId}-id`}>
        {t("kumiko.error.reference", { id: requestId })}
      </Text>
      {CopyButton !== undefined && (
        <CopyButton
          text={requestId}
          label={t("kumiko.error.copyReference")}
          copiedLabel={t("kumiko.error.referenceCopied")}
          className="min-h-0 h-7"
          testId={`${testId}-copy`}
        />
      )}
    </Grid>
  );
}
