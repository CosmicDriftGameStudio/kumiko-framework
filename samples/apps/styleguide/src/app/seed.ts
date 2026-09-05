import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

import { demoEntity } from "../features/demo/feature";

// Gibt der List-View echte Rows mit Status-/Flag-Vielfalt. price (money)
// bleibt leer — der Money-Input zeigt sich im Edit-Screen, im Seed lassen wir
// ihn weg um nicht von der money-Payload-Form abzuhängen.
// ponytail: kein Idempotenz-Check — die Screenshot-DB ist ephemer (frisch pro
// Boot). Beim `bun run dev` gegen die persistente Dev-DB dupliziert ein
// Neustart die Rows; das ist hier nur eine Demo, daher egal.
const STATUSES = ["draft", "review", "published", "archived"] as const;

// Fixed across boots (unlike the framework-minted ids for every other seed
// row) so the "edit-existing" screenshot scenario has a stable /item-edit/
// <id> URL to hit — the DB is ephemeral per boot, so a captured id would
// otherwise change every run.
export const FIRST_STYLEGUIDE_ITEM_ID = "00000000-0000-4000-8000-0000000000f1";

export const seedStyleguideItems: SeedFn = async (stack) => {
  // Bypass the write-handler HTTP path for the first row — its schema has
  // no `id` field (buildInsertSchema only exposes entity fields), so an
  // explicit id would be silently stripped before reaching the executor.
  // Calling the executor directly is the framework's documented "seed
  // pattern" for a caller-chosen aggregate id (event-store-executor-write.ts).
  const { executor } = createEntityExecutor("item", demoEntity);
  const tenantDb = createTenantDb(stack.db, TestUsers.admin.tenantId);

  for (let i = 0; i < 8; i++) {
    const payload = {
      ...(i === 0 && { id: FIRST_STYLEGUIDE_ITEM_ID }),
      name: `Demo item #${i + 1}`,
      description: i % 2 === 0 ? `Notes for demo item ${i + 1}` : "",
      quantity: (i % 5) + 1,
      rating: (i % 3) + 1,
      isActive: i % 4 !== 0,
      status: STATUSES[i % STATUSES.length],
      publishedAt: "2026-06-30",
    };
    if (i === 0) {
      const res = await executor.create(payload, TestUsers.admin, tenantDb);
      if (!res.isSuccess) {
        // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
        console.error(`[seed] styleguide item ${i + 1} failed:`, res.error);
        return;
      }
      continue;
    }
    const res = await stack.http.write("styleguide:write:item:create", payload, TestUsers.admin);
    if (!res.ok) {
      // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
      console.error(`[seed] styleguide item ${i + 1} failed:`, await res.text());
      return;
    }
  }
};
