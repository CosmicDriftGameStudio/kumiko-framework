// Shared contract for inbound-mail-foundation provider plugins — analog
// to describeKmsAdapterContract (packages/framework/src/crypto/__tests__).
// Cursor payloads are provider-opaque here (imap: {uidValidity,lastUid},
// inmemory: {offset}) — the contract only round-trips nextCursor, never
// inspects its shape. Error-path behaviour stays provider-specific
// (verify/wrong-credentials semantics don't line up across providers).

import { describe, expect, test } from "bun:test";
import type { InboundMailContext, InboundMailProviderPlugin, MailAccountRecord } from "../types";

export type InboundMailProviderContractFixture = {
  readonly plugin: InboundMailProviderPlugin;
  readonly ctx: InboundMailContext;
  readonly account: MailAccountRecord;
  /** Injects a message with the given subject into the provider's
   *  backing store (imap: sends real mail; inmemory: seedInboundMessage). */
  readonly seed: (subject: string) => Promise<void>;
};

export function describeInboundMailProviderContract(
  name: string,
  factory: () => InboundMailProviderContractFixture | Promise<InboundMailProviderContractFixture>,
  opts?: { readonly skip?: boolean },
): void {
  // Eager sync probe so a provider without `watch` produces a visible
  // test.skip instead of a silent 0-assertion pass (#1337). Both current
  // factories (imap, inmemory) are sync object literals; an async factory
  // falls back to the old runtime `if (!plugin.watch) return` check below.
  const probe = factory();
  const watchProbe = probe instanceof Promise ? undefined : Boolean(probe.plugin.watch);

  describe(`${name} — InboundMailProviderPlugin contract`, () => {
    const t = opts?.skip ? test.skip : test;
    t("verify resolves for a valid account", async () => {
      const { plugin, ctx, account } = await factory();
      await expect(plugin.verify(ctx, account)).resolves.toBeUndefined();
    });

    t(
      "fetch: backfill picks up a seeded message, incremental cursor finds nothing new",
      async () => {
        const { plugin, ctx, account, seed } = await factory();
        const subject = `contract-${crypto.randomUUID()}`;
        await seed(subject);

        const first = await plugin.fetch(ctx, account, null, {
          backfillWindowDays: 1,
          maxMessages: 50,
        });
        expect(first.messages.some((m) => m.subject === subject)).toBe(true);

        const second = await plugin.fetch(ctx, account, first.nextCursor, {
          backfillWindowDays: 1,
          maxMessages: 50,
        });
        expect(second.messages.some((m) => m.subject === subject)).toBe(false);
      },
    );

    const watchTest = watchProbe === false ? test.skip : t;
    watchTest("watch: pushes a seeded message via onMessages", async () => {
      const { plugin, ctx, account, seed } = await factory();
      if (!plugin.watch) return; // fallback for an async factory (watchProbe undefined)
      const subject = `contract-watch-${crypto.randomUUID()}`;

      const pushed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("watch push not received within 5s")),
          5_000,
        );
        void plugin
          .watch?.(ctx, account, {
            onMessages: async (msgs) => {
              if (msgs.some((m) => m.subject === subject)) {
                clearTimeout(timer);
                resolve();
              }
            },
            onError: (err) => {
              clearTimeout(timer);
              reject(err instanceof Error ? err : new Error(String(err)));
            },
          })
          .then((stop) => {
            void seed(subject).catch(reject);
            void pushed.finally(() => void stop().catch(() => {}));
          }, reject);
      });

      await pushed;
    });
  });
}
