// Live-IMAP-Test gegen greenmail (Plan §6 Phase 2, opt-in):
//   docker run -d --name cdgs-greenmail -p 3025:3025 -p 3143:3143 \
//     -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.users=testuser:testpass@example.com" \
//     greenmail/standalone:2.1.0
//
// Läuft NUR wenn der Server erreichbar ist (top-level Probe) — sonst
// skippen alle Tests sichtbar statt rot zu sein. Verifiziert die
// Plan-Pflichten: fetch-Backfill + inkrementeller Cursor, IDLE-Push
// < 5 s, Auth-Fehler → InboundAuthError.
//
// **Provider-Level-Test:** getestet wird das imapflow-Wiring des
// Plugins gegen einen echten IMAP-Server. Der ctx ist der schmale
// InboundMailContext des Provider-Contracts (kein HandlerContext);
// das Secret-Slot-Read wird mit einem minimalen SecretsContext bedient
// — der volle Dispatcher-Pfad ist in
// inbound-mail-foundation.integration.test.ts abgedeckt.

import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { createSecret } from "@cosmicdrift/kumiko-framework/secrets";
import { createTransport } from "nodemailer";
import {
  type InboundMailContext,
  isInboundAuthError,
  type MailAccountRecord,
  type RawInboundMessage,
} from "../../inbound-mail-foundation";
import { describeInboundMailProviderContract } from "../../inbound-mail-foundation/__tests__/inbound-mail-provider-contract";
import { imapInboundMailPlugin } from "../feature";

const HOST = process.env["IMAP_LIVE_HOST"] ?? "127.0.0.1";
const IMAP_PORT = Number(process.env["IMAP_LIVE_PORT"] ?? 3143);
const SMTP_PORT = Number(process.env["IMAP_LIVE_SMTP_PORT"] ?? 3025);
const USER = "testuser";
const PASSWORD = "testpass";
const ADDRESS = "testuser@example.com";

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const available = await probe(HOST, IMAP_PORT);
const liveTest = available ? test : test.skip;
if (!available) {
  console.warn(
    `imap-live: kein IMAP-Server auf ${HOST}:${IMAP_PORT} — Live-Tests werden geskippt (greenmail starten, siehe Header)`,
  );
}

function credentialDoc(password: string): string {
  return JSON.stringify({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    user: USER,
    password,
  });
}

/** Minimaler SecretsContext für den Provider-Contract-ctx — liefert das
 *  Credential-Dokument aus einer Map statt aus der DB. */
function ctxWithCredentials(doc: string): InboundMailContext {
  return {
    // Worker-Identity fürs Secret-Read-Audit (requireSecretsContext).
    _userId: "imap-live-test",
    secrets: {
      get: async () => createSecret(doc),
      has: async () => true,
      set: async () => {},
      delete: async () => {},
    } as unknown as import("@cosmicdrift/kumiko-framework/secrets").SecretsContext, // @cast-boundary test-double, nur get()/has() werden gelesen
  };
}

const account: MailAccountRecord = {
  id: "00000000-0000-4000-8000-000000001a01",
  tenantId: "00000000-0000-4000-8000-000000004242",
  provider: "imap",
  authMethod: "password",
  ownerUserId: null,
  address: ADDRESS,
  displayName: "Live-Test",
  status: "active",
  watchState: "idle",
};

async function sendTestMail(subject: string, text: string): Promise<void> {
  const transport = createTransport({ host: HOST, port: SMTP_PORT, secure: false });
  await transport.sendMail({
    from: "Sender <sender@example.com>",
    to: ADDRESS,
    subject,
    text,
  });
  transport.close();
}

describe("imap-live — echter Server (greenmail)", () => {
  liveTest(
    "verify: korrekte Credentials ok, falsches Passwort → InboundAuthError",
    async () => {
      await imapInboundMailPlugin.verify(ctxWithCredentials(credentialDoc(PASSWORD)), account);

      try {
        await imapInboundMailPlugin.verify(
          ctxWithCredentials(credentialDoc("wrong-pass")),
          account,
        );
        throw new Error("expected verify to throw");
      } catch (e) {
        expect(isInboundAuthError(e)).toBe(true);
      }
    },
    20_000,
  );

  liveTest(
    "fetch: Backfill liefert die Mail, inkrementeller Cursor liefert danach nichts Neues",
    async () => {
      const ctx = ctxWithCredentials(credentialDoc(PASSWORD));
      const subject = `backfill-${crypto.randomUUID()}`;
      await sendTestMail(subject, "Hallo aus dem Live-Test");

      const first = await imapInboundMailPlugin.fetch(ctx, account, null, {
        backfillWindowDays: 1,
        maxMessages: 50,
      });
      const match = first.messages.find((m) => m.subject === subject);
      expect(match).toBeDefined();
      expect(match?.from).toContain("sender@example.com");
      expect(match?.snippet).toContain("Hallo aus dem Live-Test");
      expect(match?.rawMime).not.toBeNull();
      expect(typeof first.nextCursor["uidValidity"]).toBe("string");
      expect(typeof first.nextCursor["lastUid"]).toBe("number");

      // Inkrementell ab Cursor: nichts Neues.
      const second = await imapInboundMailPlugin.fetch(ctx, account, first.nextCursor, {
        backfillWindowDays: 1,
        maxMessages: 50,
      });
      expect(second.messages).toHaveLength(0);
      expect(second.nextCursor["lastUid"]).toBe(first.nextCursor["lastUid"]);
    },
    30_000,
  );

  liveTest(
    "watch (IDLE): neue Mail wird in < 5 s gepusht",
    async () => {
      const ctx = ctxWithCredentials(credentialDoc(PASSWORD));
      const subject = `idle-${crypto.randomUUID()}`;

      const pushed = new Promise<readonly RawInboundMessage[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("IDLE push not received within 5s")),
          5_000,
        );
        void imapInboundMailPlugin
          .watch?.(ctx, account, {
            onMessages: async (msgs) => {
              if (msgs.some((m) => m.subject === subject)) {
                clearTimeout(timer);
                resolve(msgs);
              }
            },
            onError: (err) => {
              clearTimeout(timer);
              reject(err instanceof Error ? err : new Error(String(err)));
            },
          })
          .then((stop) => {
            // Nach Aufbau der IDLE-Verbindung die Mail schicken.
            void sendTestMail(subject, "IDLE push").catch(reject);
            // stop() nach Auflösung — pushed-Promise cleanup.
            void pushed.finally(() => void stop().catch(() => {}));
          }, reject);
      });

      const msgs = await pushed;
      expect(msgs.some((m) => m.subject === subject)).toBe(true);
    },
    20_000,
  );
});

describeInboundMailProviderContract(
  "imap (greenmail)",
  () => ({
    plugin: imapInboundMailPlugin,
    ctx: ctxWithCredentials(credentialDoc(PASSWORD)),
    account,
    seed: (subject) => sendTestMail(subject, "contract seed"),
  }),
  { skip: !available },
);
