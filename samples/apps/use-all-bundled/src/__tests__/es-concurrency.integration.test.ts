// Event sourcing under concurrency on real bundled entities (tags, tag assignments) and
// the app's note entity, booted like the dev app with real sessions. Covers: parallel
// writers on one aggregate, the same requestId sent concurrently, and a projection
// rebuild compared row by row against the live read models after mixed parallel commands.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type KumikoServerHandle, runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { seedTenant } from "@cosmicdrift/kumiko-dev-server/testing";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import type { InProcessSeededTenant } from "@cosmicdrift/kumiko-testing";
import { PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e/constants";
import { devAppOptions } from "../app/dev-app-options";

const ENV_KEYS = [
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const READ_TABLES = ["read_demo_notes", "read_tags", "read_tag_assignments"] as const;

const NOTE = {
  create: "notes-demo:write:note:create",
  update: "notes-demo:write:note:update",
  delete: "notes-demo:write:note:delete",
  detail: "notes-demo:query:note:detail",
} as const;
const TAG = {
  create: "tags:write:tag:create",
  update: "tags:write:tag:update",
  delete: "tags:write:tag:delete",
  detail: "tags:query:tag:detail",
  assign: "tags:write:assign-tag",
  remove: "tags:write:remove-tag",
} as const;

let handle: KumikoServerHandle;
let tenant: InProcessSeededTenant;
let admin: SessionUser;

type WriteOutcome = {
  status: number;
  body: { isSuccess?: boolean; data?: { id?: string }; error?: { code?: string } };
};

async function write(type: string, payload: unknown, requestId?: string): Promise<WriteOutcome> {
  const res = await handle.stack.http.write(type, payload, admin, requestId);
  return { status: res.status, body: (await res.json()) as WriteOutcome["body"] };
}

async function versionOf(detail: string, id: string): Promise<number | undefined> {
  const res = await handle.stack.http.query(detail, { id }, admin);
  const text = await res.text();
  if (res.status !== 200) return undefined;
  const body = JSON.parse(text) as { data?: { version?: number } | null };
  return body.data?.version ?? undefined;
}

async function snapshot(): Promise<Map<string, string>> {
  const raw = asRawClient(handle.stack.db);
  const result = new Map<string, string>();
  for (const table of READ_TABLES) {
    // Read-only comparison dump of the tenant's read-model rows.
    const rows = await raw.unsafe(
      `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "tenant_id" = $1 ORDER BY "id"::text`,
      [tenant.id],
    );
    result.set(table, JSON.stringify(rows));
  }
  return result;
}

// Deterministic LCG so a failing mix can be replayed.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

beforeAll(async () => {
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  const {
    clientEntry: _client,
    htmlPath: _html,
    watchDirs: _watch,
    seeds: _seeds,
    ...options
  } = devAppOptions;
  handle = await runDevApp({
    ...options,
    port: 0,
    installSignalHandlers: false,
    stylesheet: false,
  });
  tenant = await seedTenant(handle.stack, { persist: true });
  admin = tenant.admin.session;
});

afterAll(async () => {
  await handle?.stop();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("event sourcing under concurrency", () => {
  test("parallel updates with the same version: exactly one wins, the rest get version_conflict", async () => {
    const created = await write(NOTE.create, { title: "contended" });
    const id = created.body.data?.id;
    if (!id) throw new Error(`note create failed: ${JSON.stringify(created.body)}`);
    const version = await versionOf(NOTE.detail, id);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        write(NOTE.update, { id, version, changes: { title: `writer-${n}` } }),
      ),
    );
    const winners = outcomes.filter((o) => o.status === 200);
    const losers = outcomes.filter((o) => o.status !== 200);
    expect(winners).toHaveLength(1);
    for (const loser of losers) expect(loser.body.error?.code).toBe("version_conflict");
    expect(await versionOf(NOTE.detail, id)).toBe((version ?? 0) + 1);
  });

  test("the same requestId sent concurrently creates the record exactly once", async () => {
    const requestId = crypto.randomUUID();
    const title = `idempotent-${requestId}`;
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => write(NOTE.create, { title }, requestId)),
    );
    const raw = asRawClient(handle.stack.db);
    const rows = (await raw.unsafe(
      `SELECT "id"::text AS id FROM "read_demo_notes" WHERE "tenant_id" = $1 AND "title" = $2`,
      [tenant.id, title],
    )) as ReadonlyArray<{ id: string }>;
    const statuses = outcomes.map(
      (o) => `${o.status}:${o.body.error?.code ?? o.body.data?.id ?? ""}`,
    );
    console.log(`ES-IDEMPOTENCY ${JSON.stringify({ statuses, rows: rows.length })}`);
    expect(rows).toHaveLength(1);
    for (const outcome of outcomes.filter((o) => o.status === 200)) {
      expect(outcome.body.data?.id).toBe(rows[0]?.id);
    }
  });

  test("re-assigning a tag after it was deleted does not revive the cascaded assignment", async () => {
    const note = await write(NOTE.create, { title: "restore-target" });
    const tag = await write(TAG.create, { name: `restore-tag-${crypto.randomUUID()}` });
    const ref = {
      tagId: tag.body.data?.id ?? "",
      entityType: "note",
      entityId: note.body.data?.id ?? "",
    };
    expect((await write(TAG.assign, ref)).status).toBe(200);
    expect((await write(TAG.delete, { id: ref.tagId })).status).toBe(200);

    const reassigned = await write(TAG.assign, ref);

    const raw = asRawClient(handle.stack.db);
    const live = (await raw.unsafe(
      `SELECT "id"::text AS id FROM "read_tag_assignments"
        WHERE "tenant_id" = $1 AND "tag_id"::text = $2 AND "is_deleted" = false`,
      [tenant.id, ref.tagId],
    )) as ReadonlyArray<{ id: string }>;
    expect({ status: reassigned.status, liveAssignments: live.length }).toEqual({
      status: 404,
      liveAssignments: 0,
    });
  });

  test("rebuild after 100 mixed parallel commands reproduces the live read models", async () => {
    const random = createRandom(20261020);
    const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)];
    const noteIds: string[] = [];
    const tagIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const note = await write(NOTE.create, { title: `base-note-${i}` });
      const tag = await write(TAG.create, { name: `base-tag-${i}` });
      if (note.body.data?.id) noteIds.push(note.body.data.id);
      if (tag.body.data?.id) tagIds.push(tag.body.data.id);
    }

    const tally = new Map<string, number>();
    let issued = 0;
    for (let wave = 0; wave < 10; wave++) {
      const commands: Array<Promise<{ kind: string; outcome: WriteOutcome }>> = [];
      for (let slot = 0; slot < 10; slot++) {
        issued++;
        const roll = random();
        const run = async (): Promise<{ kind: string; outcome: WriteOutcome }> => {
          if (roll < 0.12) {
            const outcome = await write(NOTE.create, { title: `note-${wave}-${slot}` });
            if (outcome.body.data?.id) noteIds.push(outcome.body.data.id);
            return { kind: "note:create", outcome };
          }
          if (roll < 0.3) {
            const id = pick(noteIds) ?? "";
            const version = await versionOf(NOTE.detail, id);
            return {
              kind: "note:update",
              outcome: await write(NOTE.update, {
                id,
                version,
                changes: { title: `edit-${wave}-${slot}` },
              }),
            };
          }
          if (roll < 0.36) {
            return {
              kind: "note:delete",
              outcome: await write(NOTE.delete, { id: pick(noteIds) ?? "" }),
            };
          }
          if (roll < 0.46) {
            const outcome = await write(TAG.create, { name: `tag-${wave}-${slot}` });
            if (outcome.body.data?.id) tagIds.push(outcome.body.data.id);
            return { kind: "tag:create", outcome };
          }
          if (roll < 0.58) {
            const id = pick(tagIds) ?? "";
            const version = await versionOf(TAG.detail, id);
            return {
              kind: "tag:update",
              outcome: await write(TAG.update, {
                id,
                version,
                changes: { color: `#${(wave * 10 + slot).toString(16).padStart(6, "0")}` },
              }),
            };
          }
          if (roll < 0.64) {
            return {
              kind: "tag:delete",
              outcome: await write(TAG.delete, { id: pick(tagIds) ?? "" }),
            };
          }
          const ref = {
            tagId: pick(tagIds) ?? "",
            entityType: "note",
            entityId: pick(noteIds) ?? "",
          };
          if (roll < 0.88) return { kind: "assign", outcome: await write(TAG.assign, ref) };
          return { kind: "remove", outcome: await write(TAG.remove, ref) };
        };
        commands.push(run());
      }
      for (const { kind, outcome } of await Promise.all(commands)) {
        const key = `${kind} ${outcome.status}${outcome.body.error?.code ? ` ${outcome.body.error.code}` : ""}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
    expect(issued).toBe(100);
    const unexpected = [...tally.keys()].filter((key) => / 5\d\d/.test(key));

    const raw = asRawClient(handle.stack.db);
    // Live assignments whose tag no longer exists: delete-tag lists the assignments it can see,
    // while an assign-tag that checked the tag before the delete committed lands afterwards.
    const orphans = (await raw.unsafe(
      `SELECT a."id"::text AS id FROM "read_tag_assignments" a
        WHERE a."tenant_id" = $1
          AND a."is_deleted" = false
          AND a."tag_id"::text = ANY($2)
          AND NOT EXISTS (SELECT 1 FROM "read_tags" t WHERE t."id"::text = a."tag_id"::text)`,
      [tenant.id, tagIds],
    )) as ReadonlyArray<{ id: string }>;

    const orphanHistory: string[] = [];
    for (const orphan of orphans) {
      const tagRef = (await raw.unsafe(
        `SELECT "tag_id"::text AS tag FROM "read_tag_assignments" WHERE "id"::text = $1`,
        [orphan.id],
      )) as ReadonlyArray<{ tag: string }>;
      // Read-only look at the event history of the orphan and its tag.
      const events = (await raw.unsafe(
        `SELECT "id"::text AS seq, "aggregate_id"::text AS agg, "type", "version" FROM "kumiko_events"
          WHERE "aggregate_id"::text IN ($1, $2) ORDER BY "id"`,
        [orphan.id, tagRef[0]?.tag ?? ""],
      )) as ReadonlyArray<{ seq: string; agg: string; type: string; version: number }>;
      orphanHistory.push(
        events
          .map(
            (e) => `${e.seq}:${e.agg === orphan.id ? "assignment" : "tag"}:${e.type}@${e.version}`,
          )
          .join(" "),
      );
    }
    const before = await snapshot();
    const rebuilt: Array<{ projection: string; drift: number; events: number }> = [];
    for (const [name, projection] of handle.stack.registry.getAllProjections()) {
      const sources = Array.isArray(projection.source) ? projection.source : [projection.source];
      if (!sources.some((source) => ["note", "tag", "tag-assignment"].includes(String(source))))
        continue;
      const result = await rebuildProjection(name, {
        db: handle.stack.db,
        registry: handle.stack.registry,
      });
      rebuilt.push({
        projection: name,
        drift: result.columnDriftCount,
        events: result.eventsProcessed,
      });
    }
    const after = await snapshot();
    const differingTables = READ_TABLES.filter((table) => before.get(table) !== after.get(table));
    const diffSample = differingTables.map((table) => {
      const live = JSON.parse(before.get(table) ?? "[]") as Array<{ row: Record<string, unknown> }>;
      const replayed = JSON.parse(after.get(table) ?? "[]") as Array<{
        row: Record<string, unknown>;
      }>;
      const liveIds = new Set(live.map((r) => String(r.row["id"])));
      const replayedIds = new Set(replayed.map((r) => String(r.row["id"])));
      return {
        table,
        live: live.length,
        replayed: replayed.length,
        onlyLive: [...liveIds].filter((id) => !replayedIds.has(id)).slice(0, 5),
        onlyReplayed: [...replayedIds].filter((id) => !liveIds.has(id)).slice(0, 5),
      };
    });
    console.log(
      `ES-REBUILD ${JSON.stringify({ tally: Object.fromEntries(tally), rebuilt, orphans: orphans.length, orphanHistory, differingTables, diffSample }, null, 1)}`,
    );
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(unexpected).toEqual([]);
    expect(differingTables).toEqual([]);
    expect(rebuilt.filter((r) => r.drift > 0)).toEqual([]);
    expect(orphans).toEqual([]);
  });
});
