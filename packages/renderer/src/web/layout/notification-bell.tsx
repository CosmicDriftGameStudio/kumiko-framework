import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { InAppInboxRow } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import { Bell } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type ReactNode, useState } from "react";
import { lastSegment, useLocale, useNav, useTranslation } from "../../index.ts";
import { useRelativeTimeFormatter } from "../app/relative-time.ts";
import { cn } from "../lib/cn.ts";
import { useInAppInbox } from "./use-in-app-inbox.ts";

const MAX_BADGE_COUNT = 99;

const triggerClass =
  "relative inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-input " +
  "bg-background text-foreground shadow-xs transition-colors hover:bg-accent " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const panelClass =
  "z-50 flex max-h-[28rem] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-md border " +
  "bg-popover text-popover-foreground shadow-md";

export function NotificationBell({
  screens,
}: {
  readonly screens: readonly ScreenDefinition[];
}): ReactNode {
  const t = useTranslation();
  const nav = useNav();
  const locale = useLocale().locale();
  const formatRelative = useRelativeTimeFormatter(locale);
  const [open, setOpen] = useState(false);
  const inbox = useInAppInbox(open);

  const badge =
    inbox.unreadCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(inbox.unreadCount);
  const label =
    inbox.unreadCount > 0
      ? t("kumiko.notifications.labelUnread", { count: badge })
      : t("kumiko.notifications.label");

  const openRow = async (row: InAppInboxRow): Promise<void> => {
    if (!row.isRead) await inbox.markRead(row.id);
    const target = row.target;
    if (target === null) return;
    if (!screens.some((screen) => screen.id === target.screenId)) return;
    const screenId = lastSegment(target.screenId);
    setOpen(false);
    nav.navigate(
      target.entityId === undefined ? { screenId } : { screenId, entityId: target.entityId },
    );
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-kumiko-layout="notification-bell"
          className={triggerClass}
        >
          <Bell className="size-4" aria-hidden="true" />
          {inbox.unreadCount > 0 && (
            <span
              data-kumiko-layout="notification-bell-badge"
              className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
            >
              {badge}
            </span>
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" sideOffset={6} className={panelClass}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">{t("kumiko.notifications.title")}</h2>
            {inbox.unreadCount > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => void inbox.markAllRead()}
              >
                {t("kumiko.notifications.markAllRead")}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {inbox.failed && (
              <p role="alert" className="px-3 py-4 text-sm text-destructive">
                {t("kumiko.notifications.loadFailed")}
              </p>
            )}
            {!inbox.failed && !inbox.loading && inbox.rows.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("kumiko.notifications.empty")}
              </p>
            )}
            <ul>
              {inbox.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    data-unread={row.isRead ? undefined : "true"}
                    className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => void openRow(row)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        row.isRead ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    {!row.isRead && (
                      <span className="sr-only">{t("kumiko.notifications.unread")}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn("block truncate text-sm", !row.isRead && "font-semibold")}
                      >
                        {row.title}
                      </span>
                      {row.body !== null && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.body}
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {formatRelative(Date.parse(row.createdAt))}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {inbox.hasMore && (
              <button
                type="button"
                className="w-full px-3 py-2 text-sm text-primary hover:bg-accent"
                onClick={() => void inbox.loadMore()}
              >
                {t("kumiko.notifications.loadMore")}
              </button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
