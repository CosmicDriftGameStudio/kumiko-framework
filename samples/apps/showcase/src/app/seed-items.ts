// Seed für die Showcase-Item-Liste — ~200 items damit der Pager 4
// Seiten hat zum Durchklicken (pageSize: 50). Geht durch den normalen
// Dispatcher (showcase:write:item:create) — das hängt sich an alle
// Pipeline-Stufen (Validation, Field-Defaults, Read-Side-Update,
// Search-Index, Audit) genau wie ein echter HTTP-Request, also bricht
// auch nicht wenn das Schema sich ändert (softDelete, neue Felder).
//
// Idempotent: wenn schon ≥100 items existieren, skip — der Server wird
// bei jedem Restart neu geseeded sonst.

import type { SeedFn } from "@kumiko/dev-server";
import { TestUsers } from "@kumiko/framework/testing";
import { sql } from "drizzle-orm";

const STATUSES = ["draft", "active", "blocked", "done"] as const;

// Determinist-Pseudo-Random damit Seeds reproduzierbar sind. Mulberry32
// reicht für Demo-Distribution; kein Crypto, kein "echter" Zufall.
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
  // toTableName("item") → "read_items". Direct-SQL-COUNT für die Skip-
  // Probe — billiger als ein listOk + Length-Check.
  const existing = await stack.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM read_items WHERE tenant_id = ${TestUsers.admin.tenantId}`,
  );
  if ((existing[0]?.count ?? 0) >= 100) {
    // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
    console.log(`[showcase-seed] read_items has ${existing[0]?.count} rows — skip`);
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

  const now = new Date();
  for (let i = 0; i < COUNT; i++) {
    const subject = subjects[Math.floor(rng() * subjects.length)] ?? "Item";
    const target = targets[Math.floor(rng() * targets.length)] ?? "x";
    const verb = verbs[Math.floor(rng() * verbs.length)] ?? "do";
    const title = `${subject}: ${verb} ${target} (#${i + 1})`;
    const status = STATUSES[Math.floor(rng() * STATUSES.length)] ?? "draft";
    const isDone = status === "done";
    const priority = Math.min(5, Math.floor(rng() * rng() * 6) + 1);
    const dueOffsetDays = Math.floor(rng() * 90) - 30;
    const due = new Date(now.getTime() + dueOffsetDays * 86_400_000);
    // Zod-Validation für type:"date" verlangt YYYY-MM-DD (siehe
    // schema-builder buildInsertSchema). dialect.toDriver() coercd das
    // zu start-of-day UTC bevor die DB es sieht — Caller-API bleibt
    // wie der Author sie erwartet.
    const dueDate = due.toISOString().slice(0, 10);

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
