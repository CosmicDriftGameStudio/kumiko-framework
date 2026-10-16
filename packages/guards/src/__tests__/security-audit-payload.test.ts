import { describe, expect, test } from "bun:test";
import {
  BunAuditUnavailableError,
  decodeBunAuditPayload,
  isGzipPayload,
  parseBunAuditStreams,
  stripAnsi,
} from "../_lib/security-audit";

describe("decodeBunAuditPayload", () => {
  test("passes through plain JSON UTF-8", () => {
    const raw = new TextEncoder().encode('{ "lodash": [] }\n');
    expect(decodeBunAuditPayload(raw)).toBe('{ "lodash": [] }');
  });

  test("gunzips when stdout is gzip (CI pipe quirk)", () => {
    const json = '{ "left-pad": [{ "severity": "high" }] }';
    const gz = Bun.gzipSync(new TextEncoder().encode(json));
    expect(isGzipPayload(gz)).toBe(true);
    expect(decodeBunAuditPayload(gz)).toBe(json);
  });

  test("empty input → empty string", () => {
    expect(decodeBunAuditPayload(new Uint8Array())).toBe("");
  });

  test("strips ANSI before returning (colored bun --json)", () => {
    const colored = '\u001b[32m{ "ok": [] }\u001b[0m';
    expect(stripAnsi(colored)).toBe('{ "ok": [] }');
    expect(decodeBunAuditPayload(new TextEncoder().encode(colored))).toBe('{ "ok": [] }');
  });

  test("strips non-color CSI codes too (line-clear, cursor-hide) — a color-only regex leaves these and JSON.parse still fails", () => {
    const withCsi = '\u001b[2K\u001b[?25l{ "ok": [] }';
    expect(stripAnsi(withCsi)).toBe('{ "ok": [] }');
  });

  test("strips bun audit version banner before JSON", () => {
    const withBanner = 'bun audit v1.4.0\n{ "lodash": [] }';
    expect(decodeBunAuditPayload(new TextEncoder().encode(withBanner))).toBe('{ "lodash": [] }');
    expect(parseBunAuditStreams(new TextEncoder().encode(withBanner), new Uint8Array())).toEqual({
      lodash: [],
    });
  });
});

describe("parseBunAuditStreams", () => {
  test("prefers the stream that JSON.parse accepts", () => {
    const json = '{ "left-pad": [{ "severity": "high" }] }';
    const gz = Bun.gzipSync(new TextEncoder().encode(json));
    const warning = new TextEncoder().encode("warn: something non-json\n");
    // Non-JSON text on stdout, gzip JSON on stderr — old `a || b` kept stdout.
    expect(parseBunAuditStreams(warning, gz)).toEqual({
      "left-pad": [{ severity: "high" }],
    });
  });

  test("accepts gzip on stdout with empty stderr", () => {
    const json = '{ "ok": [] }';
    const gz = Bun.gzipSync(new TextEncoder().encode(json));
    expect(parseBunAuditStreams(gz, new Uint8Array())).toEqual({ ok: [] });
  });

  test("corrupt gzip on stdout + valid JSON on stderr succeeds", () => {
    const valid = new TextEncoder().encode('{ "ok": [] }');
    // gzip magic + truncated body → gunzip throws; must not abort before stderr
    const corruptGz = Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0xff]);
    expect(parseBunAuditStreams(corruptGz, valid)).toEqual({ ok: [] });
  });

  // Contract change (infra#414): a stream without any `{` carries no body at
  // all — that is the advisory fetch having failed, not malformed data. It no
  // longer reaches JSON.parse, so the failure names the real cause instead of
  // `Unexpected identifier "bun"`.
  test("no `{` on either stream → BunAuditUnavailableError, not a parse error", () => {
    const a = new TextEncoder().encode("bun audit v1.4.0 (0d9b296a)");
    const b = new TextEncoder().encode("");
    expect(() => parseBunAuditStreams(a, b)).toThrow(BunAuditUnavailableError);
    expect(() => parseBunAuditStreams(a, b)).toThrow(/advisory fetch/);
  });

  // infra#416: this is the more common unavailable path (banner without a
  // JSON body), and it used to drop exitCode — only the empty-stdout-and-
  // stderr path in runBunAuditOnce threaded it through.
  test("exitCode is threaded into the error message on the banner-without-body path", () => {
    const a = new TextEncoder().encode("bun audit v1.4.0 (0d9b296a)");
    const b = new TextEncoder().encode("");
    expect(() => parseBunAuditStreams(a, b, 1)).toThrow(/\(exit 1\)/);
  });

  test("the unavailable error quotes both streams verbatim for diagnosis", () => {
    const a = new TextEncoder().encode("bun audit v1.4.0 (0d9b296a)");
    const b = new TextEncoder().encode("connect ETIMEDOUT");
    expect(() => parseBunAuditStreams(a, b)).toThrow(/bun audit v1\.4\.0/);
    expect(() => parseBunAuditStreams(a, b)).toThrow(/ETIMEDOUT/);
  });

  test("whitespace-only streams are unavailable too", () => {
    const ws = new TextEncoder().encode("   \n\t  ");
    expect(() => parseBunAuditStreams(ws, ws)).toThrow(BunAuditUnavailableError);
  });

  test("malformed JSON that DOES have a body still fails as a parse error", () => {
    const broken = new TextEncoder().encode('{ "lodash": [');
    const b = new TextEncoder().encode("");
    expect(() => parseBunAuditStreams(broken, b)).toThrow(/tried 1 stream\(s\)/);
  });

  test("a body-less first stream is skipped; the second one wins", () => {
    const nullJson = new TextEncoder().encode("null");
    const ok = new TextEncoder().encode('{ "ok": [] }');
    expect(parseBunAuditStreams(nullJson, ok)).toEqual({ ok: [] });
  });

  test("truncated gzip alone throws (no silent empty)", () => {
    const corruptGz = Uint8Array.from([0x1f, 0x8b, 0x00]);
    expect(() => parseBunAuditStreams(corruptGz, new Uint8Array())).toThrow(/non-JSON/);
  });

  test("an error/status object (e.g. rate-limited) throws instead of silently reporting zero advisories", () => {
    const rateLimited = new TextEncoder().encode('{"error":"rate limited"}');
    const empty = new TextEncoder().encode("");
    expect(() => parseBunAuditStreams(rateLimited, empty)).toThrow(/not a plain object/);
  });

  test("a numeric-valued object throws a diagnosable error instead of a raw non-iterable TypeError", () => {
    const countOnly = new TextEncoder().encode('{"count":3}');
    const empty = new TextEncoder().encode("");
    expect(() => parseBunAuditStreams(countOnly, empty)).toThrow(/not a plain object/);
  });
});
