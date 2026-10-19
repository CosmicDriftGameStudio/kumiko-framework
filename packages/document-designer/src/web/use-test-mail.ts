// @runtime client
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  useMutation,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";
import type { SendTestResponse, SendTestStatus } from "./mail-types.ts";

const TOO_MANY_REQUESTS = 429;

export type TestMailState =
  | { readonly kind: "idle" }
  | { readonly kind: "sent"; readonly subject: string }
  | { readonly kind: "error"; readonly text: string };

// While the status loads, or when it cannot be read, canSend is false and reason is null: the
// button stays disabled without a hint.
export type TestMailAvailability = {
  readonly canSend: boolean;
  readonly reason: SendTestStatus["reason"];
};

export type TestMail = {
  readonly availability: TestMailAvailability;
  readonly state: TestMailState;
  readonly pending: boolean;
  readonly send: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
};

// The recipient is always the caller; the server never returns the address.
export function useTestMail(): TestMail {
  const t = useTranslation();
  const sendTest = useMutation<SendTestResponse>(TemplateResolverHandlers.sendTest);
  const status = useQuery<SendTestStatus>(TemplateResolverQueries.sendTestStatus, {});
  const availability: TestMailAvailability = {
    canSend: status.data?.canSend === true,
    reason: status.data?.reason ?? null,
  };
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
  return { availability, state, pending: sendTest.pending, send };
}
