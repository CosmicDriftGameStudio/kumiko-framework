import {
  IN_APP_NOTIFICATION_DELIVERED_EVENT,
  IN_APP_NOTIFICATION_QUERIES,
  IN_APP_NOTIFICATION_WRITES,
  type InAppInboxResult,
  type InAppInboxRow,
} from "@cosmicdrift/kumiko-types/in-app-notification-types";
import { useCallback, useEffect, useState } from "react";
import { useDispatcher } from "../../context/dispatcher-context.tsx";
import { useMutation } from "../../hooks/use-mutation.ts";
import { useQuery } from "../../hooks/use-query.ts";
import { useLiveEvents } from "../../sse/live-events.tsx";

export const IN_APP_INBOX_PAGE_SIZE = 20;

export type InAppInbox = {
  readonly unreadCount: number;
  readonly rows: readonly InAppInboxRow[];
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly loadMore: () => Promise<void>;
  readonly markRead: (id: number) => Promise<void>;
  readonly markAllRead: () => Promise<void>;
};

/** Headless state of the notification bell: the unread count always, the list only while `open`.
 *  The delivered signal refetches both; no polling. */
export function useInAppInbox(open: boolean): InAppInbox {
  const dispatcher = useDispatcher();
  const subscribe = useLiveEvents();
  const count = useQuery<{ count: number }>(IN_APP_NOTIFICATION_QUERIES.unreadCount, {});
  const firstPage = useQuery<InAppInboxResult>(
    IN_APP_NOTIFICATION_QUERIES.inbox,
    { limit: IN_APP_INBOX_PAGE_SIZE },
    { enabled: open },
  );
  const [olderRows, setOlderRows] = useState<readonly InAppInboxRow[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const markReadWrite = useMutation(IN_APP_NOTIFICATION_WRITES.markRead);
  const markAllReadWrite = useMutation(IN_APP_NOTIFICATION_WRITES.markAllRead);

  const refetchCount = count.refetch;
  const refetchFirstPage = firstPage.refetch;
  const refetchAll = useCallback(async (): Promise<void> => {
    setOlderRows([]);
    setOlderCursor(undefined);
    await Promise.all([refetchCount(), open ? refetchFirstPage() : Promise.resolve()]);
  }, [refetchCount, refetchFirstPage, open]);

  useEffect(
    () => subscribe(IN_APP_NOTIFICATION_DELIVERED_EVENT, () => void refetchAll()),
    [subscribe, refetchAll],
  );

  const firstRows = firstPage.data?.rows ?? [];
  const nextCursor = olderCursor === undefined ? (firstPage.data?.nextCursor ?? null) : olderCursor;

  const loadMore = useCallback(async (): Promise<void> => {
    // skip: no older page left
    if (nextCursor === null) return;
    const result = await dispatcher.query<InAppInboxResult>(IN_APP_NOTIFICATION_QUERIES.inbox, {
      limit: IN_APP_INBOX_PAGE_SIZE,
      cursor: nextCursor,
    });
    // skip: keep the loaded rows, the next click retries
    if (!result.isSuccess) return;
    setOlderRows((previous) => [...previous, ...result.data.rows]);
    setOlderCursor(result.data.nextCursor);
  }, [dispatcher, nextCursor]);

  const markRead = useCallback(
    async (id: number): Promise<void> => {
      await markReadWrite.mutate({ id });
      await refetchAll();
    },
    [markReadWrite.mutate, refetchAll],
  );
  const markAllRead = useCallback(async (): Promise<void> => {
    await markAllReadWrite.mutate({});
    await refetchAll();
  }, [markAllReadWrite.mutate, refetchAll]);

  return {
    unreadCount: count.data?.count ?? 0,
    rows: [...firstRows, ...olderRows],
    hasMore: nextCursor !== null,
    loading: firstPage.loading,
    failed: firstPage.error !== null,
    loadMore,
    markRead,
    markAllRead,
  };
}
