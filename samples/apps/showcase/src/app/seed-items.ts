// Seed for the showcase item list — ~200 items so the pager has 4
// pages to click through (pageSize: 50). Goes through the normal
// dispatcher (showcase:write:item:create) — that hooks into all
// pipeline stages (validation, field defaults, read-side update,
// search index, audit) just like a real HTTP request, so it does not
// break when the schema changes (softDelete, new fields).
//
// Idempotent: if ≥100 items already exist, skip — otherwise the server is
// re-seeded on every restart.

import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";

const STATUSES = ["draft", "active", "blocked", "done"] as const;

// Deterministic pseudo-random so seeds are reproducible. Mulberry32
// is enough for demo distribution; no crypto, no "real" randomness.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedShowcaseItems: SeedFn = async (stack) => {
  // Skip probe through the list handler, not direct SQL: the seed then knows
  // nothing about table names, and survives a read-side rename. total:true +
  // limit:1 counts server-side instead of comparing rows.length against a
  // page size — a future max-limit clamp below 100 would otherwise make
  // this probe never reach the threshold and re-seed 200 items every boot.
  const existing = await stack.http.queryOk<{ rows: readonly unknown[]; total?: number }>(
    "showcase:query:item:list",
    { limit: 1, totalCount: true },
    TestUsers.admin,
  );
  const existingCount = existing.total ?? 0;
  if (existingCount >= 100) {
    // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
    console.log(`[showcase-seed] ${existingCount}+ items present — skip`);
    return;
  }

  const rng = mulberry32(0xc0ffee);
  const COUNT = 200;
  const subjects = [
    "Onboarding",
    "Bug",
    "Feature",
    "Spike",
    "Refactor",
    "Cleanup",
    "Doc",
    "Migration",
    "Audit",
    "Review",
  ];
  const targets = [
    "auth",
    "billing",
    "dashboard",
    "search",
    "exports",
    "imports",
    "notifications",
    "settings",
    "reports",
    "ingestion",
  ];
  const verbs = ["fix", "add", "remove", "rename", "improve", "investigate", "polish", "rewrite"];

  const now = Temporal.Now.instant();
  for (let i = 0; i < COUNT; i++) {
    const subject = subjects[Math.floor(rng() * subjects.length)] ?? "Item";
    const target = targets[Math.floor(rng() * targets.length)] ?? "x";
    const verb = verbs[Math.floor(rng() * verbs.length)] ?? "do";
    const title = `${subject}: ${verb} ${target} (#${i + 1})`;
    const status = STATUSES[Math.floor(rng() * STATUSES.length)] ?? "draft";
    const isDone = status === "done";
    const priority = Math.min(5, Math.floor(rng() * rng() * 6) + 1);
    const dueOffsetDays = Math.floor(rng() * 90) - 30;
    const due = now.add({ hours: dueOffsetDays * 24 });
    // Zod validation for type:"date" requires YYYY-MM-DD (see
    // schema-builder buildInsertSchema). dialect.toDriver() coerces that
    // to start-of-day UTC before the DB sees it — the caller API stays
    // as the author expects it.
    const dueDate = due.toString().slice(0, 10);

    const res = await stack.http.write(
      "showcase:write:item:create",
      {
        title,
        status,
        isDone,
        priority,
        dueDate,
        notes: isDone ? `Closed ${target} ticket.` : "",
      },
      TestUsers.admin,
    );
    if (!res.ok) {
      const body = await res.text();
      // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
      console.warn(`[showcase-seed] item ${i + 1} failed (${res.status}):`, body);
      // Versuche cause-detail aus dem dev-mode Error-Body zu fischen
      // (serializeError exposed cause auf error.details bei NODE_ENV
      // !== production). Wenn da was steht, ist's der echte server-
      // side Stack-Trace.
      try {
        const parsed = JSON.parse(body) as { error?: { details?: unknown } };
        if (parsed.error?.details !== undefined) {
          // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
          console.warn("[showcase-seed] details:", parsed.error.details);
        }
      } catch {
        // body was not JSON — already logged the raw text above
      }
      // Erste Fehler-Zeile reicht — typisch ist die ganze Schar betroffen
      // (Schema-Mismatch, Auth-Issue), kein Sinn alle 200 zu probieren.
      return;
    }
  }

  // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
  console.log(`[showcase-seed] created ${COUNT} items via dispatch`);
};
