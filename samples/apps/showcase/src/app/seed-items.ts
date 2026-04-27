// Seed für die Showcase-Item-Liste — ~200 items damit der Pager 4
// Seiten hat zum Durchklicken (pageSize: 50). Direct-SQL-Insert in die
// Read-Tabelle umgeht den Event-Store; für eine pure-UI-Demo ist das
// okay (kein Audit-Trail, aber Pager/Sort/Search funktionieren wie in
// Production-Setup mit echten Events).
//
// Idempotent: wenn schon ≥100 items existieren, skip — der Server wird
// bei jedem Restart neu geseeded sonst und die Liste wächst infinit.

import type { SeedFn } from "@kumiko/dev-server";
import type { TenantId } from "@kumiko/framework/engine";
import { TestUsers } from "@kumiko/framework/testing";
import { generateId } from "@kumiko/framework/utils";
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
  const tenantId = TestUsers.admin.tenantId as TenantId;
  const userId = TestUsers.admin.id;

  const existing = await stack.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM read_items WHERE tenant_id = ${tenantId}`,
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
  const rows = Array.from({ length: COUNT }, (_, i) => {
    const subject = subjects[Math.floor(rng() * subjects.length)] ?? "Item";
    const target = targets[Math.floor(rng() * targets.length)] ?? "x";
    const verb = verbs[Math.floor(rng() * verbs.length)] ?? "do";
    const title = `${subject}: ${verb} ${target} (#${i + 1})`;
    const status = STATUSES[Math.floor(rng() * STATUSES.length)] ?? "draft";
    const isDone = status === "done";
    // Priority 1–5, leicht skewed auf niedrige Werte (P1 + P2 häufiger).
    const priority = Math.min(5, Math.floor(rng() * rng() * 6) + 1);
    // Due-Date in [-30, +60] Tagen ab heute, gleichverteilt.
    const dueOffsetDays = Math.floor(rng() * 90) - 30;
    const due = new Date(now.getTime() + dueOffsetDays * 86_400_000);
    const dueDate = due.toISOString().slice(0, 10);
    return {
      id: generateId(),
      tenantId,
      title,
      status,
      isDone,
      priority,
      dueDate,
      notes: isDone ? `Closed ${target} ticket.` : null,
    };
  });

  // Bulk-INSERT — ein Roundtrip statt N. read_items hat die
  // Standard-Read-Side-Felder (id, tenant_id, version, created_*,
  // updated_*, …), wir füllen nur die Domain-Felder + System-Defaults.
  // Einfacher Loop reicht — 200 Inserts sind ~50ms gesamt.
  for (const r of rows) {
    await stack.db.execute(
      sql`
        INSERT INTO read_items
          (id, tenant_id, title, status, is_done, priority, due_date, notes,
           version, is_deleted, created_at, updated_at, created_by, updated_by)
        VALUES
          (${r.id}, ${r.tenantId}, ${r.title}, ${r.status}, ${r.isDone}, ${r.priority},
           ${r.dueDate}, ${r.notes},
           1, false, now(), now(), ${userId}, ${userId})
        ON CONFLICT (id) DO NOTHING
      `,
    );
  }

  // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
  console.log(`[showcase-seed] inserted ${rows.length} items into read_items`);
};
