export type ContextKind = "handler" | "job";

export interface NamespacePath {
  readonly namespace: string;
  readonly leaf: string;
}

const SERVICE_NAMES: readonly string[] = [
  "redis",
  "cacheSync",
  "jobRunner",
  "searchAdapter",
  "entityCache",
  "secrets",
  "kms",
  "files",
  "derivatives",
  "configResolver",
  "configEncryption",
  "rateLimit",
  "effectiveFeatures",
  "masterKeyProvider",
  "_fileProviderResolver",
  "_notifyFactory",
  "_notifyInTransactionFactory",
  "_notifyAfterCommitFactory",
  "_escapeHatchAuditSink",
];

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
  ["meter", { namespace: "obs", leaf: "meter" }],
  ["runPreSave", { namespace: "lifecycle", leaf: "runPreSave" }],
  ["scheduleAfterCommit", { namespace: "lifecycle", leaf: "afterCommit" }],
  ["scheduleAfterRollback", { namespace: "lifecycle", leaf: "afterRollback" }],
  ["signal", { namespace: "lifecycle", leaf: "signal" }],
  ["configFor", { namespace: "tenants", leaf: "config" }],
  ["forTenant", { namespace: "tenants", leaf: "writeTarget" }],
  ...SERVICE_NAMES.map((name): [string, NamespacePath] => [
    name,
    { namespace: "services", leaf: name },
  ]),
]);

const JOB_MOVED_NAMES: readonly string[] = [
  "appendEvent",
  "write",
  "writeAs",
  "queryAs",
  "queryAsMember",
  "log",
  "metricsFor",
  "meter",
  "signal",
  ...SERVICE_NAMES,
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

// Flat members a structural parameter may still declare, with where the context carries them now.
const REMOVED_FLAT_MEMBERS: readonly string[] = ["systemUser", "triggeredBy", "_tenantId"];

export function flatMemberTarget(memberName: string): string | undefined {
  const path = HANDLER_MOVES.get(memberName);
  if (path !== undefined) return describePath(path);
  return REMOVED_FLAT_MEMBERS.includes(memberName)
    ? "nowhere (removed from HandlerContext)"
    : undefined;
}

// Members the new HandlerContext and JobContext carry. A cast over a narrowed context type can read
// one of them, and that read must never be redirected into services.extensions.
const CONTEXT_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "auth",
  "config",
  "crossTenantReads",
  "db",
  "dispatch",
  "events",
  "hasFeature",
  "includeDeleted",
  "lifecycle",
  "locale",
  "notify",
  "obs",
  "rateLimitDigest",
  "registry",
  "services",
  "systemDb",
  "tenants",
  "tz",
  "user",
  "attempt",
  "canDefer",
  "defer",
  "finalAttempt",
  "triggerEvent",
  "triggerName",
]);

export function isContextMemberName(memberName: string): boolean {
  return CONTEXT_MEMBER_NAMES.has(memberName);
}
