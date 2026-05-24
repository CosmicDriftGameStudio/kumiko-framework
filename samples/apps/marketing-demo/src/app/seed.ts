// Seed für Marketing-Demo. Plausible Daten — Asset-Tracker mit ~30
// realistischen Items (Laptops, Drucker, Werkzeuge), Helpdesk mit ~20
// echten-aussehenden Tickets. Geht durch den normalen Dispatcher
// (assets:write:asset:create, helpdesk:write:ticket:create) damit alle
// Pipeline-Stufen (Validation, Audit, Search-Index) wie bei echten
// Requests laufen.
//
// Daten leben in seed-data.ts (Templates + Personen-Listen). Hier bleibt
// nur Logik: Random-Generator, Datums-Helper, der eigentliche Seed.

import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "temporal-polyfill";
import { ASSET_STATUSES } from "../features/assets/schema";
import { TICKET_SEVERITIES, TICKET_STATUSES } from "../features/helpdesk/schema";
import {
  ASSET_TEMPLATES,
  ASSIGNEES,
  LOCATIONS,
  OWNERS,
  REPORTERS,
  TICKET_TEMPLATES,
} from "./seed-data";

// YYYY-MM-DD-Helper über Temporal.PlainDate — Date-API ist im Repo per
// No-Date-API-Guard verboten (siehe docs/plans/architecture/timezones.md).
function formatPlainDate(year: number, month: number, day: number): string {
  return Temporal.PlainDate.from({ year, month, day }).toString();
}

// Determinist-Pseudo-Random — gleicher Seed → gleiche Daten zwischen
// Runs, damit Marketing-Screenshots reproduzierbar bleiben.
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(values: ReadonlyArray<T>, r: () => number, fallback: T): T {
  return values[Math.floor(r() * values.length)] ?? fallback;
}

export const seedMarketingDemo: SeedFn = async (stack) => {
  const tenantId = TestUsers.admin.tenantId;

  // Asset-Tracker — skip wenn schon ≥20 Rows da
  const existingAssets = await asRawClient(stack.db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM read_assets WHERE tenant_id = $1`,
    [tenantId],
  );
  if ((existingAssets[0]?.count ?? 0) < 20) {
    const r = rng(42);
    let serialCounter = 1000;
    for (const tpl of ASSET_TEMPLATES) {
      // Jedes Asset bekommt 1-3 Instanzen (z.B. zwei MacBooks)
      const copies = 1 + Math.floor(r() * 3);
      for (let i = 0; i < copies; i++) {
        const status = pick(ASSET_STATUSES, r, "available");
        const owner = status === "lent" ? OWNERS[1 + Math.floor(r() * (OWNERS.length - 1))] : "";
        const location = pick(LOCATIONS, r, "Büro Berlin 2.OG");
        const purchaseYear = 2023 + Math.floor(r() * 3);
        // Temporal-month ist 1..12, day 1..28 ist beidseitig safe.
        const purchaseDate = formatPlainDate(
          purchaseYear,
          1 + Math.floor(r() * 12),
          1 + Math.floor(r() * 28),
        );
        const warrantyYears = 2 + Math.floor(r() * 3);
        const warrantyUntil = formatPlainDate(
          purchaseYear + warrantyYears,
          1 + Math.floor(r() * 12),
          1 + Math.floor(r() * 28),
        );
        const price = tpl.priceMin + Math.floor(r() * (tpl.priceMax - tpl.priceMin + 1));
        await stack.http.write(
          "assets:write:asset:create",
          {
            name: copies > 1 ? `${tpl.name} #${i + 1}` : tpl.name,
            type: tpl.type,
            status,
            department: tpl.department,
            owner,
            location,
            serialNumber: `SN-${serialCounter++}`,
            vendor: tpl.vendor,
            price,
            purchaseDate,
            warrantyUntil,
            notes: "",
          },
          TestUsers.admin,
        );
      }
    }
    // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
    console.log(`[marketing-demo seed] assets seeded`);
  }

  // Helpdesk — skip wenn schon ≥10 Rows da
  const existingTickets = await asRawClient(stack.db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM read_tickets WHERE tenant_id = $1`,
    [tenantId],
  );
  if ((existingTickets[0]?.count ?? 0) < 10) {
    const r = rng(7);
    // Anker für dueDate: 2026-05-01 — bewusst konstant, damit Screenshots
    // reproduzierbar bleiben (auch wenn der Seed später läuft).
    const today = Temporal.PlainDate.from({ year: 2026, month: 5, day: 1 });
    for (const tpl of TICKET_TEMPLATES) {
      const severity = pick(TICKET_SEVERITIES, r, "medium");
      const status = pick(TICKET_STATUSES, r, "open");
      const reporter = pick(REPORTERS, r, "Anna Weber");
      const assignee = pick(ASSIGNEES, r, "");
      // dueDate: -3 bis +14 Tage — Mix aus überfällig + bald.
      const dueDate = today.add({ days: Math.floor(r() * 18) - 3 }).toString();
      // spentMinutes: 0 für offene, mehr für bearbeitete/gelöste.
      const spentMinutes =
        status === "open"
          ? Math.floor(r() * 15)
          : status === "investigating"
            ? 15 + Math.floor(r() * 90)
            : 30 + Math.floor(r() * 240);
      await stack.http.write(
        "helpdesk:write:ticket:create",
        {
          title: tpl.title,
          description: `Gemeldet von ${reporter}. Bitte zeitnah prüfen.`,
          category: tpl.category,
          severity,
          status,
          department: tpl.department,
          reporter,
          assignee,
          dueDate,
          spentMinutes,
        },
        TestUsers.admin,
      );
    }
    // biome-ignore lint/suspicious/noConsole: sample-server diagnostics
    console.log(`[marketing-demo seed] tickets seeded`);
  }
};
