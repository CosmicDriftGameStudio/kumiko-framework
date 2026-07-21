// Always-on unit coverage for imapInboundMailPlugin.verify/fetch/watch.
// Greenmail suites skip in CI when the container is down — this file mocks
// imapflow so the plugin body stays on the coverage badge without Docker.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createSecret } from "@cosmicdrift/kumiko-framework/secrets";
import {
  type InboundMailContext,
  isInboundAuthError,
  isInboundCursorInvalidError,
  isInboundTransientError,
  type MailAccountRecord,
  type RawInboundMessage,
} from "../../inbound-mail-foundation";

type FakeMsg = {
  readonly uid: number;
  readonly source: Buffer;
  readonly internalDate: Date;
};

type FakeState = {
  connectError?: Error;
  authFailed?: boolean;
  uidValidity: string;
  uidNext: number;
  messages: FakeMsg[];
  /** When set, search() returns this list instead of all message uids. */
  searchUids?: number[];
};

let state: FakeState;
let lastIdleClient: FakeImapFlow | undefined;

class FakeImapFlow extends EventEmitter {
  mailbox: { uidValidity: bigint; uidNext: number } | false = false;
  private idleReject: ((err: Error) => void) | undefined;

  constructor(_opts: unknown) {
    super();
    lastIdleClient = this;
  }

  async connect(): Promise<void> {
    if (state.connectError) {
      const err = state.connectError as Error & { authenticationFailed?: boolean };
      if (state.authFailed) err.authenticationFailed = true;
      throw err;
    }
  }

  async logout(): Promise<void> {
    this.idleReject?.(new Error("connection closed"));
    this.idleReject = undefined;
  }

  async getMailboxLock(_box: string): Promise<{ release: () => void }> {
    this.mailbox = {
      uidValidity: BigInt(state.uidValidity),
      uidNext: state.uidNext,
    };
    return { release: () => {} };
  }

  async mailboxOpen(_box: string): Promise<{ uidValidity: bigint; uidNext: number }> {
    this.mailbox = {
      uidValidity: BigInt(state.uidValidity),
      uidNext: state.uidNext,
    };
    return this.mailbox;
  }

  async search(_query: unknown, _opts?: unknown): Promise<number[]> {
    return state.searchUids ?? state.messages.map((m) => m.uid);
  }

  async *fetch(
    range: string,
    _opts?: unknown,
    _uidOpts?: unknown,
  ): AsyncGenerator<{
    uid: number;
    source: Buffer;
    internalDate: Date;
  }> {
    // Real imapflow is called with either "N,M,…" (explicit uid list) or "N:*".
    const wanted = new Set<number>();
    if (range.includes("*")) {
      const start = Number(range.split(":")[0]);
      for (const m of state.messages) {
        if (m.uid >= start) wanted.add(m.uid);
      }
    } else {
      for (const part of range.split(",")) {
        const n = Number(part.trim());
        if (Number.isFinite(n)) wanted.add(n);
      }
    }
    for (const m of state.messages) {
      if (wanted.size > 0 && !wanted.has(m.uid)) continue;
      yield { uid: m.uid, source: m.source, internalDate: m.internalDate };
    }
  }

  async idle(): Promise<void> {
    await new Promise<void>((_resolve, reject) => {
      this.idleReject = reject;
    });
  }
}

mock.module("imapflow", () => ({ ImapFlow: FakeImapFlow }));

const { imapInboundMailPlugin } = await import("../feature");

function mime(subject: string, text: string): Buffer {
  return Buffer.from(
    [
      "From: Sender <sender@example.com>",
      "To: inbox@example.com",
      `Subject: ${subject}`,
      "Message-ID: <msg-1@example.com>",
      "Date: Mon, 01 Jan 2024 12:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text,
    ].join("\r\n"),
  );
}

const account: MailAccountRecord = {
  id: "00000000-0000-4000-8000-000000001a01",
  tenantId: "00000000-0000-4000-8000-000000004242",
  provider: "imap",
  authMethod: "password",
  ownerUserId: null,
  address: "inbox@example.com",
  displayName: "Mock",
  status: "active",
  watchState: "idle",
};

function ctxWithDoc(doc: string | null): InboundMailContext {
  return {
    _userId: "imap-plugin-mocked",
    secrets: {
      get: async () => (doc === null ? null : createSecret(doc)),
      has: async () => doc !== null,
      set: async () => {},
      delete: async () => {},
    } as unknown as import("@cosmicdrift/kumiko-framework/secrets").SecretsContext, // @cast-boundary test-double
  };
}

const goodDoc = JSON.stringify({
  host: "imap.example.com",
  port: 993,
  secure: true,
  user: "u@example.com",
  password: "pw",
});

beforeEach(() => {
  lastIdleClient = undefined;
  state = {
    uidValidity: "17",
    uidNext: 3,
    messages: [
      {
        uid: 1,
        source: mime("one", "hello one"),
        internalDate: new Date("2024-01-01T12:00:00Z"),
      },
      {
        uid: 2,
        source: mime("two", "hello two"),
        internalDate: new Date("2024-01-02T12:00:00Z"),
      },
    ],
  };
});

describe("imapInboundMailPlugin — mocked imapflow", () => {
  test("verify: connect+logout happy path", async () => {
    await expect(
      imapInboundMailPlugin.verify(ctxWithDoc(goodDoc), account),
    ).resolves.toBeUndefined();
  });

  test("verify: auth failure → InboundAuthError", async () => {
    state.connectError = new Error("Authentication failed");
    state.authFailed = true;
    try {
      await imapInboundMailPlugin.verify(ctxWithDoc(goodDoc), account);
      expect.unreachable("expected verify to throw");
    } catch (e) {
      expect(isInboundAuthError(e)).toBe(true);
    }
  });

  test("verify: missing credential secret → InboundAuthError", async () => {
    try {
      await imapInboundMailPlugin.verify(ctxWithDoc(null), account);
      expect.unreachable("expected verify to throw");
    } catch (e) {
      expect(isInboundAuthError(e)).toBe(true);
    }
  });

  test("verify: malformed credential JSON → InboundAuthError", async () => {
    try {
      await imapInboundMailPlugin.verify(ctxWithDoc("not-json"), account);
      expect.unreachable("expected verify to throw");
    } catch (e) {
      expect(isInboundAuthError(e)).toBe(true);
    }
  });

  test("fetch: backfill (null cursor) returns messages + nextCursor", async () => {
    const result = await imapInboundMailPlugin.fetch(ctxWithDoc(goodDoc), account, null, {
      backfillWindowDays: 7,
      maxMessages: 50,
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.subject).toBe("one");
    expect(result.nextCursor).toEqual({ uidValidity: "17", lastUid: 2 });
    expect(result.hasMore).toBe(false);
  });

  test("fetch: incremental cursor filters uid <= lastUid + hasMore via maxMessages", async () => {
    state.searchUids = [1, 2, 3, 4];
    state.messages = [
      {
        uid: 2,
        source: mime("two", "x"),
        internalDate: new Date("2024-01-02T12:00:00Z"),
      },
      {
        uid: 3,
        source: mime("three", "y"),
        internalDate: new Date("2024-01-03T12:00:00Z"),
      },
      {
        uid: 4,
        source: mime("four", "z"),
        internalDate: new Date("2024-01-04T12:00:00Z"),
      },
    ];
    const result = await imapInboundMailPlugin.fetch(
      ctxWithDoc(goodDoc),
      account,
      { uidValidity: "17", lastUid: 1 },
      { backfillWindowDays: 7, maxMessages: 2 },
    );
    // search returns 2,3,4 (> lastUid=1); maxMessages=2 → hasMore
    expect(result.messages.length).toBeLessThanOrEqual(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor["uidValidity"]).toBe("17");
  });

  test("fetch: UIDVALIDITY change → InboundCursorInvalidError", async () => {
    try {
      await imapInboundMailPlugin.fetch(
        ctxWithDoc(goodDoc),
        account,
        { uidValidity: "16", lastUid: 1 },
        { backfillWindowDays: 7, maxMessages: 50 },
      );
      expect.unreachable("expected fetch to throw");
    } catch (e) {
      expect(isInboundCursorInvalidError(e)).toBe(true);
    }
  });

  test("fetch: network error → InboundTransientError", async () => {
    state.connectError = new Error("ECONNREFUSED");
    try {
      await imapInboundMailPlugin.fetch(ctxWithDoc(goodDoc), account, null, {
        backfillWindowDays: 7,
        maxMessages: 50,
      });
      expect.unreachable("expected fetch to throw");
    } catch (e) {
      expect(isInboundTransientError(e)).toBe(true);
    }
  });

  test("watch: exists → onMessages, stop() tears down", async () => {
    expect(imapInboundMailPlugin.watch).toBeDefined();
    const received: RawInboundMessage[][] = [];
    const stop = await imapInboundMailPlugin.watch!(ctxWithDoc(goodDoc), account, {
      onMessages: async (msgs) => {
        received.push([...msgs]);
      },
      onError: () => {},
    });

    // New mail above uidNext-1 (uidNext=3 → nextUid starts at 3)
    state.messages = [
      {
        uid: 3,
        source: mime("pushed", "idle body"),
        internalDate: new Date("2024-01-05T12:00:00Z"),
      },
    ];
    lastIdleClient?.emit("exists");

    await Bun.sleep(50);
    expect(received.some((batch) => batch.some((m) => m.subject === "pushed"))).toBe(true);

    await stop();
  });

  test("watch: client error → onError once", async () => {
    let errors = 0;
    const stop = await imapInboundMailPlugin.watch!(ctxWithDoc(goodDoc), account, {
      onMessages: async () => {},
      onError: () => {
        errors += 1;
      },
    });
    lastIdleClient?.emit("error", new Error("socket hang up"));
    await Bun.sleep(20);
    lastIdleClient?.emit("error", new Error("second"));
    await Bun.sleep(20);
    expect(errors).toBe(1);
    await stop().catch(() => {});
  });
});
