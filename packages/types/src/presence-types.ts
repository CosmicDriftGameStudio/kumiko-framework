// Contract between the presence feature (server) and the presence hooks and widgets in the
// renderer. The renderer must not import bundled-features, so both sides share this file.

export const PRESENCE_FEATURE = "presence" as const;

export const PRESENCE_WRITES = {
  heartbeat: "presence:write:heartbeat",
  leave: "presence:write:leave",
} as const;

export const PRESENCE_QUERIES = {
  list: "presence:query:list",
} as const;

export const PRESENCE_CHANGED_EVENT = "presence:event:changed" as const;

export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
export const PRESENCE_LIST_REFETCH_INTERVAL_MS = 25_000;
export const PRESENCE_FOCUS_MAX_LENGTH = 128;
export const PRESENCE_LIST_MAX_IDS = 100;

export type PresenceActivity = "viewing" | "editing";

export type PresenceEntry = {
  readonly userId: string;
  readonly displayName: string;
  readonly activity: PresenceActivity;
  readonly focus?: string;
  /** ISO timestamp from which the user has been in this activity and focus. */
  readonly since: string;
};

export type PresenceHeartbeatPayload = {
  readonly entity: string;
  readonly id: string;
  readonly activity: PresenceActivity;
  readonly focus?: string;
};

export type PresenceLeavePayload = {
  readonly entity: string;
  readonly id: string;
};

export type PresenceListPayload = {
  readonly entity: string;
  readonly ids: readonly string[];
};

export type PresenceHeartbeatResult = {
  readonly others: readonly PresenceEntry[];
};

export type PresenceListResult = {
  readonly byId: Readonly<Record<string, readonly PresenceEntry[]>>;
};
