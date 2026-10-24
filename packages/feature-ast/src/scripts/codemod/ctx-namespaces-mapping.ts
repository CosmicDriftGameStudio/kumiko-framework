export type ContextKind = "handler" | "job";

export interface NamespacePath {
  readonly namespace: string;
  readonly leaf: string;
}

const HANDLER_MOVES: ReadonlyMap<string, NamespacePath> = new Map([
  ["dbOutsideTransaction", { namespace: "db", leaf: "outsideTransaction" }],
  ["appendEvent", { namespace: "events", leaf: "append" }],
  ["unsafeAppendEvent", { namespace: "events", leaf: "unsafeAppend" }],
  ["tryAppendEvent", { namespace: "events", leaf: "tryAppend" }],
  ["fetchForWriting", { namespace: "events", leaf: "fetchForWriting" }],
  ["loadAggregate", { namespace: "events", leaf: "load" }],
  ["loadAggregateWithSnapshot", { namespace: "events", leaf: "loadWithSnapshot" }],
  ["snapshotAggregate", { namespace: "events", leaf: "snapshot" }],
  ["archiveStream", { namespace: "events", leaf: "archive" }],
  ["restoreStream", { namespace: "events", leaf: "restore" }],
  ["isStreamArchived", { namespace: "events", leaf: "isArchived" }],
  ["query", { namespace: "dispatch", leaf: "query" }],
  ["write", { namespace: "dispatch", leaf: "write" }],
  ["queryAs", { namespace: "dispatch", leaf: "queryAs" }],
  ["writeAs", { namespace: "dispatch", leaf: "writeAs" }],
  ["queryAsMember", { namespace: "dispatch", leaf: "queryAsMember" }],
  ["queryProjection", { namespace: "dispatch", leaf: "queryProjection" }],
  ["resolveAuthClaims", { namespace: "auth", leaf: "resolveClaims" }],
  ["resolveActiveMembership", { namespace: "auth", leaf: "resolveActiveMembership" }],
  ["metrics", { namespace: "obs", leaf: "metrics" }],
  ["metricsFor", { namespace: "obs", leaf: "metricsFor" }],
  ["tracer", { namespace: "obs", leaf: "tracer" }],
  ["log", { namespace: "obs", leaf: "log" }],
]);

const JOB_MOVED_NAMES: readonly string[] = [
  "appendEvent",
  "write",
  "writeAs",
  "queryAs",
  "queryAsMember",
  "log",
  "metricsFor",
];

const JOB_MOVES: ReadonlyMap<string, NamespacePath> = new Map(
  JOB_MOVED_NAMES.flatMap((name): [string, NamespacePath][] => {
    const path = HANDLER_MOVES.get(name);
    return path === undefined ? [] : [[name, path]];
  }),
);

export function moveOf(kind: ContextKind, memberName: string): NamespacePath | undefined {
  return (kind === "job" ? JOB_MOVES : HANDLER_MOVES).get(memberName);
}

export function isMovedMemberName(memberName: string): boolean {
  return HANDLER_MOVES.has(memberName);
}

export function describePath(path: NamespacePath): string {
  return `${path.namespace}.${path.leaf}`;
}

// Resolved per kind and compared, so a HandlerContext | JobContext union only rewrites when both agree.
export function samePath(
  left: NamespacePath | undefined,
  right: NamespacePath | undefined,
): boolean {
  return left?.namespace === right?.namespace && left?.leaf === right?.leaf;
}
