import { describe, expect, test } from "bun:test";
import {
  fromDomainOf,
  isSenderAuthenticated,
  normalizeTrustedAuthservId,
  parseSenderAuthentication,
} from "../sender-auth.ts";

const TRUSTED = "mx.example.com";
const FROM = "b.de";
const parse = (headers: string[], trusted: string | null = TRUSTED, from: string | null = FROM) =>
  parseSenderAuthentication(headers, trusted, from);

const PASS_HEADER =
  "mx.example.com; spf=pass smtp.mailfrom=a@b.de; dkim=pass header.d=b.de; dmarc=pass header.from=b.de";

describe("parseSenderAuthentication", () => {
  test("maps the results of the trusted header", () => {
    expect(parse([PASS_HEADER])).toEqual({
      authservId: "mx.example.com",
      spf: "pass",
      dkim: "pass",
      dkimDomains: ["b.de"],
      dmarc: "pass",
      fromDomain: "b.de",
    });
  });

  test("fail and softfail are fail, none stays none", () => {
    const result = parse([
      "mx.example.com; spf=softfail; dkim=fail header.d=b.de; dmarc=fail header.from=b.de",
    ]);
    expect(result).toMatchObject({ spf: "fail", dkim: "fail", dmarc: "fail" });
    expect(parse(["mx.example.com; spf=none; dmarc=none header.from=b.de"])).toMatchObject({
      spf: "none",
      dmarc: "none",
    });
  });

  test("neutral, policy, temperror and permerror are unknown", () => {
    const result = parse([
      "mx.example.com; spf=neutral; dkim=temperror; dmarc=permerror header.from=b.de",
    ]);
    expect(result).toMatchObject({ spf: "unknown", dkim: "unknown", dmarc: "unknown" });
  });

  test("a method missing from the header is unknown, not pass", () => {
    expect(parse(["mx.example.com; spf=pass"])).toMatchObject({
      spf: "pass",
      dkim: "unknown",
      dmarc: "unknown",
      dkimDomains: [],
    });
  });

  test("contradicting dmarc or spf entries are never a pass", () => {
    const result = parse([
      "mx.example.com; spf=pass; spf=fail; dmarc=pass header.from=b.de; dmarc=fail header.from=b.de",
    ]);
    expect(result).toMatchObject({ spf: "fail", dmarc: "fail" });
    expect(isSenderAuthenticated(result)).toBe(false);
  });

  test("an escaped quote inside a quoted value does not shift the result segments", () => {
    const result = parse([
      'mx.example.com; dmarc=fail header.from=b.de; spf=pass smtp.mailfrom="x\\"; dmarc=pass header.from=b.de"',
    ]);
    expect(result).toMatchObject({ spf: "pass", dmarc: "fail" });
  });

  test("several dkim results: pass wins, then fail, then none; domains are collected", () => {
    const result = parse([
      "mx.example.com; dkim=fail header.d=evil.net; dkim=pass header.d=B.de; dkim=pass header.d=b.de",
    ]);
    expect(result).toMatchObject({ dkim: "pass", dkimDomains: ["evil.net", "b.de"] });
    expect(parse(["mx.example.com; dkim=none; dkim=fail"])?.dkim).toBe("fail");
    expect(parse(["mx.example.com; dkim=none; dkim=neutral"])?.dkim).toBe("none");
  });

  test("at most ten dkim domains are kept", () => {
    const segments = Array.from({ length: 14 }, (_, i) => `dkim=pass header.d=d${i}.de`);
    expect(parse([`mx.example.com; ${segments.join("; ")}`])?.dkimDomains).toHaveLength(10);
  });

  test("no trusted id, no header or no From domain give null", () => {
    expect(parse([PASS_HEADER], null)).toBeNull();
    expect(parse([PASS_HEADER], "   ")).toBeNull();
    expect(parse([])).toBeNull();
    expect(parse([PASS_HEADER], TRUSTED, null)).toBeNull();
  });

  test("a header of a foreign server gives null", () => {
    expect(
      parse(["evil.example.net; spf=pass; dkim=pass; dmarc=pass header.from=b.de"]),
    ).toBeNull();
  });

  test("a forged pass below the real fail header does not turn it into a pass", () => {
    const result = parse([
      "mx.example.com; spf=fail; dkim=fail; dmarc=fail header.from=b.de",
      PASS_HEADER,
    ]);
    expect(result).toMatchObject({ spf: "fail", dkim: "fail", dmarc: "fail" });
    expect(isSenderAuthenticated(result)).toBe(false);
  });

  test("the first trusted header counts even below a header of another hop", () => {
    expect(parse(["relay.example.net; spf=pass", PASS_HEADER])?.dmarc).toBe("pass");
  });

  test("a header evaluated for another From domain gives null", () => {
    expect(parse([PASS_HEADER], TRUSTED, "other.de")).toBeNull();
    expect(
      parse(["mx.example.com; dmarc=pass header.from=attacker.net"], TRUSTED, "b.de"),
    ).toBeNull();
  });

  test("a dmarc pass without header.from is not bound to the From domain", () => {
    expect(parse(["mx.example.com; dmarc=pass; spf=pass"])).toMatchObject({
      dmarc: "unknown",
      spf: "pass",
    });
  });

  test("a value too long for the stored shape gives null instead of an invalid result", () => {
    const longDomain = `${"a".repeat(260)}.de`;
    expect(
      parse([`mx.example.com; dmarc=pass header.from=${longDomain}`], TRUSTED, longDomain),
    ).toBeNull();
    expect(
      parse([`mx.example.com; dkim=pass header.d=${longDomain}; dmarc=pass header.from=b.de`]),
    ).toBeNull();
  });

  test("comments, upper case, quotes and folded lines are tolerated", () => {
    const result = parse([
      'MX.Example.COM 1 (comment; with semicolon (nested));\r\n\tSPF=PASS (sender SPF authorized) smtp.mailfrom=a@b.de;\r\n  DKIM=Fail header.d="B.de" reason="a;b";\n dmarc = pass header.from=a@B.de',
    ]);
    expect(result).toEqual({
      authservId: "mx.example.com",
      spf: "pass",
      dkim: "fail",
      dkimDomains: ["b.de"],
      dmarc: "pass",
      fromDomain: "b.de",
    });
  });
});

describe("helpers", () => {
  test("isSenderAuthenticated needs a dmarc pass", () => {
    expect(isSenderAuthenticated(null)).toBe(false);
    expect(isSenderAuthenticated(parse([PASS_HEADER]))).toBe(true);
    expect(isSenderAuthenticated(parse(["mx.example.com; spf=pass; dkim=pass"]))).toBe(false);
  });

  test("trusted ids are trimmed and lower-cased, empty means unset", () => {
    expect(normalizeTrustedAuthservId(" MX.Example.com ")).toBe("mx.example.com");
    expect(normalizeTrustedAuthservId("  ")).toBeNull();
    expect(normalizeTrustedAuthservId(null)).toBeNull();
  });

  test("fromDomainOf reads the domain of an address", () => {
    expect(fromDomainOf("Anna@Example.COM")).toBe("example.com");
    expect(fromDomainOf("no-at-sign")).toBeNull();
  });
});
