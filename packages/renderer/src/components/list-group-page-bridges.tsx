// One invisible bridge per requested group page: the number of open groups and
// loaded pages varies, so useQuery can't be called in a loop. The pool caps
// group page requests at four in flight.
import { type ReactNode, useEffect, useRef } from "react";
import type { ListGroupPageResult } from "../hooks/list-group-pages.ts";
import type { ListGroupPagesProps } from "../hooks/use-list-aggregates.ts";
import { useQuery } from "../hooks/use-query.ts";

const GROUP_PAGE_CONCURRENCY = 4;

type PageRows = {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly nextCursor?: string | null;
};

function GroupPageBridge({
  pageKey,
  queryType,
  payload,
  onResult,
  refreshNonce,
}: {
  readonly pageKey: string;
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly onResult: (pageKey: string, result: ListGroupPageResult) => void;
  readonly refreshNonce: number;
}): ReactNode {
  const result = useQuery<PageRows>(queryType, payload, {
    live: true,
    concurrency: GROUP_PAGE_CONCURRENCY,
  });
  const { data, loading, refetch } = result;
  useEffect(() => {
    if (data === null) return;
    onResult(pageKey, { rows: data.rows, nextCursor: data.nextCursor ?? null, loading });
  }, [data, loading, pageKey, onResult]);
  const seenNonce = useRef(refreshNonce);
  useEffect(() => {
    // skip: the mount fetch already covers the nonce the bridge started with
    if (seenNonce.current === refreshNonce) return;
    seenNonce.current = refreshNonce;
    void refetch();
  }, [refreshNonce, refetch]);
  return null;
}

export function ListGroupPageBridges({
  queryType,
  requests,
  onResult,
  refreshNonce,
}: ListGroupPagesProps): ReactNode {
  return (
    <>
      {requests.map((request) => (
        <GroupPageBridge
          key={request.pageKey}
          pageKey={request.pageKey}
          queryType={queryType}
          payload={request.payload}
          onResult={onResult}
          refreshNonce={refreshNonce}
        />
      ))}
    </>
  );
}
