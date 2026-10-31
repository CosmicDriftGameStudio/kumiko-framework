import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { ProviderCancelOutcome } from "../events.ts";
import type { ConsumerProtectionOptions } from "../types.ts";
import { CONTRACT_TERMINATION_OPERATOR_NOTIFICATION_TYPE } from "../web/constants.ts";
import type { ConsentLocale } from "./consent-text.ts";
import { type OperatorNoticeDeclaration, operatorNoticeVariables } from "./termination-mail.ts";
import type { OperatorNoticeReason } from "./termination-texts.ts";

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

// guard:dup-ok narrows one optional ctx member with this feature's own mount hint
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
    data: operatorNoticeVariables({
      ...plan,
      operatorEmail: consumerProtection.operatorEmail,
    }),
    locale: plan.locale,
    priority: "critical",
  });
}
