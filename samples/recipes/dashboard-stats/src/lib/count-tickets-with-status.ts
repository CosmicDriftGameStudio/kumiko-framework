import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { TICKET_STATUSES, ticketExecutor } from "../schema/ticket";

export async function countTicketsWithStatus(
  status: (typeof TICKET_STATUSES)[number],
  user: SessionUser,
  db: TenantDb,
): Promise<number> {
  const page = await ticketExecutor.list(
    { filter: { field: "status", op: "eq", value: status }, limit: 1, totalCount: true },
    user,
    db,
  );
  return page.total ?? 0;
}
