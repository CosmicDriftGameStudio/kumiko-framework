import type { InAppNotificationTarget } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import * as z from "zod";

const SCREEN_ID_PATTERN = /^[^\s:]+:screen:[^\s:]+$/;

const targetSchema = z.object({
  screenId: z.string().regex(SCREEN_ID_PATTERN),
  entityId: z.string().min(1).optional(),
});

export function inAppTarget(screenId: string, entityId?: string): InAppNotificationTarget {
  return entityId === undefined ? { screenId } : { screenId, entityId };
}

// Returns null for anything that is not a well-formed target, so a malformed `data.target`
// drops only the link and never the notification.
export function parseInAppTarget(value: unknown): InAppNotificationTarget | null {
  const parsed = targetSchema.safeParse(value);
  if (!parsed.success) return null;
  const { screenId, entityId } = parsed.data;
  return inAppTarget(screenId, entityId);
}

// Reads `target` out of the stored notification data (a JSON string) or out of a raw data object.
export function targetOfNotificationData(data: unknown): InAppNotificationTarget | null {
  if (typeof data !== "object" || data === null || !("target" in data)) return null;
  return parseInAppTarget(data.target);
}

export function parseStoredNotificationData(stored: string | null): unknown {
  if (stored === null) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}
