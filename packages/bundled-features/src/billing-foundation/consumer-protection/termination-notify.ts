import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { CONTRACT_TERMINATION_OPERATOR_NOTIFICATION_TYPE } from "../constants.js";
import type { ProviderCancelOutcome } from "../events.js";
import type { ConsumerProtectionOptions } from "../types.js";
import type { ConsentLocale } from "./consent-text.js";
import { type OperatorNoticeDeclaration, renderOperatorNotice } from "./termination-mail.js";
import type { OperatorNoticeReason } from "./termination-texts.js";

export type OperatorNoticePlan = {
  readonly locale: ConsentLocale;
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly channel: "public" | "account";
  readonly declaration: OperatorNoticeDeclaration;
  readonly reasons: readonly OperatorNoticeReason[];
  readonly tenantId?: string;
  readonly providerCancel?: ProviderCancelOutcome;
};

export function requireNotify(ctx: HandlerContext): NonNullable<HandlerContext["notify"]> {
  if (!ctx.notify) {
    throw new InternalError({
      message:
        "billing-foundation:termination: ctx.notify unavailable — the delivery feature must be mounted",
    });
  }
  return ctx.notify;
}

export async function notifyOperator(
  ctx: HandlerContext,
  consumerProtection: ConsumerProtectionOptions,
  plan: OperatorNoticePlan,
): Promise<void> {
  await requireNotify(ctx)(CONTRACT_TERMINATION_OPERATOR_NOTIFICATION_TYPE, {
    route: { email: consumerProtection.operatorEmail },
    data: renderOperatorNotice({
      ...plan,
      operatorEmail: consumerProtection.operatorEmail,
    }),
    priority: "critical",
  });
}
