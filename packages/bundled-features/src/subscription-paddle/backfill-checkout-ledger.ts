// Takes over Paddle checkouts that were opened before the checkout ledger
// existed: their custom_data still carries the old tenantBinding. Once the
// first sweep is done the job keeps sweeping for an hour (checkouts opened by
// the previous release can still be paid), then does nothing.
// The tenant in custom_data is unverified: the key that signed the binding no longer exists.
// Only origin "api" and the one hour window bound that; losing a paid checkout would be worse.

import {
  parseProviderConsentId,
  SubscriptionFoundationHandlers,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  createSystemUser,
  type JobContext,
  parseTenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { PADDLE_PROVIDER_NAME } from "./constants.ts";
import {
  LEDGER_BACKFILL_MARKER_HANDLER_QN,
  type LedgerBackfillMarkerResult,
} from "./ledger-backfill-marker.ts";
import type { PaddleCallSource, PaddleCtxRuntime } from "./runtime.ts";
import { tenantIdOf } from "./webhook-events.ts";

const TAKEOVER_WINDOW_MS = 60 * 60 * 1000;
const PAGE_SIZE = "200";
const MAX_PAGES = 100;
// A checkout that completed between the deploy and the first sweep is no longer draft/ready,
// but its webhook is still pending, so completed ones are listed too, for a week back.
const LISTED_STATUSES = "draft,ready,billed,paid,completed";
const LOOKBACK_DAYS = 7;

const transactionListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      custom_data: z.record(z.string(), z.unknown()).nullish(),
      items: z.array(z.object({ price: z.object({ id: z.string().min(1) }) })),
    }),
  ),
  meta: z
    .object({ pagination: z.object({ has_more: z.boolean().optional() }).optional() })
    .optional(),
});

type ListedTransaction = z.infer<typeof transactionListSchema>["data"][number];

export type BackfillDeps = {
  readonly runtime: PaddleCtxRuntime;
  readonly priceToTier: Readonly<Record<string, string>>;
};

function isLegacyCheckout(transaction: ListedTransaction): boolean {
  return typeof transaction.custom_data?.["tenantBinding"] === "string";
}

function paddleCallSourceOf(ctx: JobContext): PaddleCallSource {
  return {
    services: ctx.services,
    user: ctx.systemUser,
    ...(ctx.config && { config: ctx.config }),
  };
}

async function readMarker(
  ctx: JobContext,
  markCompleted: boolean,
): Promise<LedgerBackfillMarkerResult> {
  const result = await ctx.dispatch.write(LEDGER_BACKFILL_MARKER_HANDLER_QN, { markCompleted });
  if (!result.isSuccess) {
    throw new Error(`backfill-checkout-ledger: marker handler failed (${result.error.code})`);
  }
  return result.data as LedgerBackfillMarkerResult; // @cast-boundary engine-payload
}

export function isTakeoverWindowOver(completedAt: string, now: Temporal.Instant): boolean {
  const elapsed = now.epochMilliseconds - Temporal.Instant.from(completedAt).epochMilliseconds;
  return elapsed >= TAKEOVER_WINDOW_MS;
}

async function listOpenApiTransactions(
  ctx: JobContext,
  runtime: PaddleCtxRuntime,
  after: string | undefined,
  createdSince: string,
) {
  const raw = await runtime.call(paddleCallSourceOf(ctx), {
    method: "GET",
    path: "/transactions",
    query: {
      status: LISTED_STATUSES,
      origin: "api",
      "created_at[GTE]": createdSince,
      order_by: "id[ASC]",
      per_page: PAGE_SIZE,
      ...(after !== undefined && { after }),
    },
  });
  return transactionListSchema.parse(raw);
}

async function ledgerTransaction(
  ctx: JobContext,
  priceToTier: BackfillDeps["priceToTier"],
  transaction: ListedTransaction,
): Promise<void> {
  const tenantId = parseTenantId(tenantIdOf(transaction.custom_data));
  const priceId = transaction.items[0]?.price.id;
  // skip: a transaction without tenant or price cannot be ledgered
  if (tenantId === null || !priceId) return;
  const consentId = parseProviderConsentId(transaction.custom_data?.["consentId"]);
  const result = await ctx.dispatch.writeAs(
    createSystemUser(tenantId, ["SystemAdmin"]),
    SubscriptionFoundationHandlers.recordCheckoutOpened,
    {
      providerName: PADDLE_PROVIDER_NAME,
      providerCheckoutId: transaction.id,
      priceId,
      mode: priceId in priceToTier ? "subscription" : "payment",
      ...(consentId !== undefined && { consentId }),
    },
  );
  if (!result.isSuccess) {
    throw new Error(
      `backfill-checkout-ledger: ledgering ${transaction.id} failed (${result.error.code})`,
    );
  }
}

export async function runBackfillCheckoutLedger(
  ctx: JobContext,
  deps: BackfillDeps,
): Promise<void> {
  // skip: without an API key there is no Paddle account to sweep
  if (!(await deps.runtime.hasApiKey(paddleCallSourceOf(ctx)))) return;
  const marker = await readMarker(ctx, false);
  if (marker.completedAt !== null && isTakeoverWindowOver(marker.completedAt, ctx.tz.now())) {
    // skip: the takeover window is over
    return;
  }

  const createdSince = ctx.tz
    .now()
    .subtract({ hours: LOOKBACK_DAYS * 24 })
    .toString();
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await listOpenApiTransactions(ctx, deps.runtime, after, createdSince);
    for (const transaction of listed.data) {
      if (isLegacyCheckout(transaction))
        await ledgerTransaction(ctx, deps.priceToTier, transaction);
    }
    const last = listed.data.at(-1);
    if (listed.meta?.pagination?.has_more !== true || last === undefined) break;
    after = last.id;
  }

  if (marker.completedAt === null) await readMarker(ctx, true);
}
