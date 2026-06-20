import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

// Gibt der List-View echte Rows mit Status-/Flag-Vielfalt. price (money)
// bleibt leer — der Money-Input zeigt sich im Edit-Screen, im Seed lassen wir
// ihn weg um nicht von der money-Payload-Form abzuhängen.
// ponytail: kein Idempotenz-Check — die Screenshot-DB ist ephemer (frisch pro
// Boot). Beim `bun run dev` gegen die persistente Dev-DB dupliziert ein
// Neustart die Rows; das ist hier nur eine Demo, daher egal.
const STATUSES = ["draft", "review", "published", "archived"] as const;

export const seedStyleguideItems: SeedFn = async (stack) => {
  for (let i = 0; i < 8; i++) {
    const res = await stack.http.write(
      "styleguide:write:item:create",
      {
        name: `Demo item #${i + 1}`,
        description: i % 2 === 0 ? `Notes for demo item ${i + 1}` : "",
        quantity: (i % 5) + 1,
        rating: (i % 3) + 1,
        isActive: i % 4 !== 0,
        status: STATUSES[i % STATUSES.length],
        publishedAt: "2026-06-30",
      },
      TestUsers.admin,
    );
    if (!res.ok) {
      // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
      console.error(`[seed] styleguide item ${i + 1} failed:`, await res.text());
      return;
    }
  }
};
