// @runtime client
import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { dispatcherErrorText, useMutation, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";
import type { SendTestResponse } from "./mail-types.ts";

const TOO_MANY_REQUESTS = 429;

export type TestMailState =
  | { readonly kind: "idle" }
  | { readonly kind: "sent"; readonly subject: string }
  | { readonly kind: "error"; readonly text: string };

export type TestMail = {
  readonly state: TestMailState;
  readonly pending: boolean;
  readonly send: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
};

// The recipient is always the caller; the server never returns the address.
export function useTestMail(): TestMail {
  const t = useTranslation();
  const sendTest = useMutation<SendTestResponse>(TemplateResolverHandlers.sendTest);
  const [state, setState] = useState<TestMailState>({ kind: "idle" });

  const send = async (payload: Readonly<Record<string, unknown>>): Promise<void> => {
    setState({ kind: "idle" });
    const result = await sendTest.mutate(payload);
    if (result.isSuccess) {
      setState({ kind: "sent", subject: result.data.subject });
    } else {
      setState({
        kind: "error",
        text:
          result.error.httpStatus === TOO_MANY_REQUESTS
            ? t("documentDesigner.mail.testMail.rateLimited")
            : dispatcherErrorText(result.error, t),
      });
    }
  };
  return { state, pending: sendTest.pending, send };
}
