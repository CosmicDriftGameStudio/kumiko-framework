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
  opts?: {
    readonly skip?: boolean;
    // Whether the provider implements `watch` — read from the plugin's
    // module-level export (e.g. `Boolean(imapInboundMailPlugin.watch)`),
    // not by calling `factory()`. Calling the factory eagerly to probe
    // this (#1337) ran the imap caller's fixture construction even when
    // `skip` was true (the exact case the skip exists to avoid), and left
    // an eager Promise unawaited/uncaught on an async factory. Defaults to
    // true (run the watch test) when omitted.
    readonly hasWatch?: boolean;
    // bunfig's global test timeout (15s) is too tight for a live-IMAP
    // round-trip under CI load — imap-live.integration.test.ts's own
    // tests already use 20s for the same greenmail server.
    readonly timeout?: number;
  },
): void {
  const timeout = opts?.timeout;

  describe(`${name} — InboundMailProviderPlugin contract`, () => {
    const t = opts?.skip ? test.skip : test;
    t(
      "verify resolves for a valid account",
      async () => {
        const { plugin, ctx, account } = await factory();
        await expect(plugin.verify(ctx, account)).resolves.toBeUndefined();
      },
      timeout,
    );

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
      timeout,
    );

    const watchTest = opts?.hasWatch === false ? test.skip : t;
    watchTest(
      "watch: pushes a seeded message via onMessages",
      async () => {
        const { plugin, ctx, account, seed } = await factory();
        if (!plugin.watch) return; // safety net if opts.hasWatch drifted from the plugin
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
      },
      timeout,
    );
  });
}
