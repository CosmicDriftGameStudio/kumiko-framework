// @runtime client
import type { Dispatcher, QueryResult } from "@cosmicdrift/kumiko-headless";
import { isOverviewQueryAllowed, type OverviewWorkspaceKind } from "../overview-allowlist";

export async function overviewQuery<T>(
  kind: OverviewWorkspaceKind,
  dispatcher: Dispatcher,
  queryName: string,
  payload: Record<string, unknown>,
): Promise<QueryResult<T>> {
  if (!isOverviewQueryAllowed(kind, queryName)) {
    throw new Error(`admin-shell:overview query not allowlisted: ${queryName}`);
  }
  return dispatcher.query<T>(queryName, payload);
}
