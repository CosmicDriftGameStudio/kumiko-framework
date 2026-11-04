import { describe, expect, test } from "bun:test";
import { lineNumbers, lintWithPlugin } from "./biome-harness";

describe("no-date-api plugin", () => {
  const findings = lintWithPlugin("no-date-api", {
    "a.ts": [
      "const created = new Date(0);",
      "const iso = created.toISOString();",
      "const ms = created.getTime();",
      "const started = Date.now();",
      "const parsed = Date.parse('2026-01-01');",
      "const instant = Temporal.Now.instant();",
    ].join("\n"),
  });

  test("flags new Date, toISOString and getTime", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3]);
  });
});

describe("unsafe-json-parse plugin", () => {
  const findings = lintWithPlugin("unsafe-json-parse", {
    "a.ts": [
      "const bare = JSON.parse(input);",
      "try {",
      "  JSON.parse(input);",
      "} catch {",
      "  JSON.parse(fallback);",
      "}",
      "const safe = parseJsonSafe(input);",
      "const revived = JSON.parse(input, reviver);",
    ].join("\n"),
  });

  test("flags JSON.parse outside the try block, including inside catch and with a reviver", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 5, 8]);
  });
});

describe("error-reasons plugin", () => {
  const findings = lintWithPlugin("error-reasons", {
    "a.ts": [
      'failUnprocessable("Bad reason");',
      'failUnprocessable("order.already_cancelled");',
      "failUnprocessable(OrderReasons.cancelled);",
      'throw new UnprocessableError("badOne", "message");',
      'throw new UnprocessableError("stale_state", "message");',
      "const detail = { reason: `Not snake` };",
      'const good = { reason: "stale_state", other: 1 };',
      'const bad = { other: 1, reason: "StaleState" };',
      'const access = { openToAll: { reason: "Prose justification for the access" } };',
      'const hatch = declareEscapeHatch({ reason: "Prose justification for the hatch" });',
      'const grants = { escapeHatch: { grants: { unsafeRaw: { reason: "Prose here" } } } };',
      "const dynamic = { reason: someReasonConstant };",
    ].join("\n"),
  });

  test("flags non snake_case reasons in calls, constructors and details objects", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 4, 6, 8]);
  });
});

describe("i18n-locale-terminology plugins", () => {
  test("German strings must say Mandant, not Tenant or Organisation", () => {
    const findings = lintWithPlugin("i18n-locale-terminology-de", {
      "strings.ts": [
        "export const strings = {",
        '  a: "Tenant wechseln",',
        '  b: "Mandant wechseln",',
        '  c: "Organisation anlegen",',
        '  d: "Rolle TenantAdmin",',
        "};",
      ].join("\n"),
    });
    expect(lineNumbers(findings, "strings.ts")).toEqual([2, 4]);
  });

  test("Romance locales must not use the tenant loanword", () => {
    const findings = lintWithPlugin("i18n-locale-terminology-romance", {
      "strings.ts": [
        "export const strings = {",
        '  a: "Cambiar de tenant",',
        '  b: "Cambiar de organización",',
        '  c: "Rol TenantAdmin",',
        '  d: "Organisation wechseln",',
        "};",
      ].join("\n"),
    });
    expect(lineNumbers(findings, "strings.ts")).toEqual([2]);
  });
});

describe("admin-api plugin", () => {
  const findings = lintWithPlugin("admin-api", {
    "a.ts": [
      "await store.appendRaw(event);",
      "await admin.appendRawBatch(events);",
      "await store.append(event);",
    ].join("\n"),
  });

  test("flags appendRaw and appendRawBatch only", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2]);
  });
});

describe("es-literal-writes plugin", () => {
  const findings = lintWithPlugin("es-literal-writes", {
    "a.ts": [
      'const a = "INSERT INTO kumiko_events (id) VALUES (1)";',
      "const b = `UPDATE kumiko_snapshots SET x = @{value}`;",
      'const c = "delete from \\"kumiko_archived_streams\\" where 1 = 1";',
      'const d = "SELECT * FROM kumiko_events";',
      'const e = "UPDATE read_orders SET x = 1";',
      'const f = "CREATE TABLE read_tenant_memberships (id uuid)";',
      'const g = "INSERT INTO KUMIKO_EVENTS (id) VALUES (1)";',
    ].join("\n"),
  });

  test("flags writes on event-store tables (any case) and hand-written membership DDL", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3, 6, 7]);
  });
});

describe("raw-html-in-web plugin", () => {
  const findings = lintWithPlugin("raw-html-in-web", {
    "a.tsx": [
      "export const Screen = () => (",
      "  <div>",
      "    <button onClick={go}>Go</button>",
      '    <input type="text" />',
      '    <a href="/x">link</a>',
      "    <Button onClick={go}>Go</Button>",
      '    <span className="bg-card">x</span>',
      '    <span className="text-muted md:text-sm">x</span>',
      "  </div>",
      ");",
      'alert("hi");',
    ].join("\n"),
  });

  test("flags raw layout elements, hand-rolled cards and alert", () => {
    expect(lineNumbers(findings, "a.tsx")).toEqual([3, 7, 11]);
  });
});

describe("no-screen-container-classes plugin", () => {
  const findings = lintWithPlugin("no-screen-container-classes", {
    "a.tsx": [
      "export const Screen = () => (",
      "  <div>",
      '    <span className="mx-auto max-w-3xl">x</span>',
      '    <span className="max-w-xl p-2 mx-auto">x</span>',
      '    <span className="mx-auto">x</span>',
      '    <span className="max-w-3xl">x</span>',
      "  </div>",
      ");",
    ].join("\n"),
  });

  test("flags mx-auto combined with max-w-* in either order", () => {
    expect(lineNumbers(findings, "a.tsx")).toEqual([3, 4]);
  });
});

describe("raw-ui-in-app plugin", () => {
  const findings = lintWithPlugin("raw-ui-in-app", {
    "plain.tsx": [
      "export const Screen = () => (",
      "  <div>",
      '    <input type="text" />',
      "    <label>Name</label>",
      '    <a href="/x">link</a>',
      "    <details><summary>More</summary></details>",
      '    <span className="text-red-500">x</span>',
      '    <span className={cn("a", "bg-[#fff]")}>x</span>',
      '    <span className="shadow-md">x</span>',
      '    <span className="bg-card text-muted">x</span>',
      "  </div>",
      ");",
      "export function StatCard({ a }: Props): ReactNode {",
      "  return null;",
      "}",
      "export const OrderBadge = ({ a }: Props): ReactNode => null;",
      "export const OrderList = () => null;",
    ].join("\n"),
    "with-primitives.tsx": [
      'import { Button } from "@cosmicdrift/kumiko-renderer/web";',
      'export const A = () => <a href="/x">link</a>;',
      "export const B = () => <details><summary>More</summary></details>;",
    ].join("\n"),
    "with-use-primitives.tsx": [
      'import { usePrimitives } from "@cosmicdrift/kumiko-renderer";',
      'export const A = () => <a href="/x">link</a>;',
    ].join("\n"),
  });

  test("flags raw form tags, design classes and local primitives in any tsx", () => {
    expect(lineNumbers(findings, "plain.tsx")).toEqual([3, 4, 7, 8, 9, 13, 16]);
  });

  test("flags a, details and summary only in files that can reach the primitives", () => {
    expect(lineNumbers(findings, "with-primitives.tsx")).toEqual([2, 3, 3]);
    expect(lineNumbers(findings, "with-use-primitives.tsx")).toEqual([2]);
  });

  test("raw interactive elements only warn, every other branch is an error", () => {
    const severityOf = (file: string, line: number) =>
      findings.find((f) => f.file === file && f.line === line)?.severity;
    expect(severityOf("with-primitives.tsx", 2)).toBe("warning");
    expect(severityOf("plain.tsx", 3)).toBe("error");
    expect(severityOf("plain.tsx", 7)).toBe("error");
    expect(severityOf("plain.tsx", 13)).toBe("error");
  });
});

describe("no-temporal-polyfill-require plugin", () => {
  const findings = lintWithPlugin("no-temporal-polyfill-require", {
    "a.ts": [
      'const a = require("temporal-polyfill");',
      'const b = await import("temporal-polyfill/global");',
      'const c = require("temporal-polyfill-other");',
      'const d = require("node:path");',
    ].join("\n"),
  });

  test("flags require and dynamic import of the polyfill, not lookalikes", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2]);
  });
});

describe("no-raw-hooks plugin", () => {
  const findings = lintWithPlugin("no-raw-hooks", {
    "a.tsx": [
      "useState(0);",
      "useEffect(() => {}, []);",
      "useLayoutEffect(() => {});",
      "React.useEffect(() => {});",
      "R.useLayoutEffect(() => {});",
      "React.useMemo(() => 1, []);",
      "useQuery({});",
    ].join("\n"),
  });

  test("flags effect hook calls, bare and namespaced", () => {
    expect(lineNumbers(findings, "a.tsx")).toEqual([2, 3, 4, 5]);
  });
});

describe("no-direct-fs plugin", () => {
  const findings = lintWithPlugin("no-direct-fs", {
    "a.ts": [
      'import { readFileSync } from "node:fs";',
      'import fs from "fs";',
      'import * as fsp from "fs/promises";',
      'import { readFile } from "node:fs/promises";',
      'import "node:fs";',
      'export { readFileSync as read } from "node:fs";',
      'const lazy = await import("node:fs");',
      'const legacy = require("fs");',
      'import path from "node:path";',
      'import { filesystem } from "./fs";',
      'import legacyFs = require("node:fs");',
      'export { readFileSync, writeFileSync } from "fs";',
      'export * as everything from "fs";',
      'export * from "./fs";',
    ].join("\n"),
  });

  test("flags every fs module spelling and form", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13]);
  });
});

describe("test-title plugin", () => {
  const findings = lintWithPlugin("test-title", {
    "a.test.ts": [
      'test("returns the value", () => {});',
      'test("gibt den Wert zurück", () => {});',
      'it("liefert nichts wenn leer", () => {});',
      'describe("ticket #1234 regression", () => {});',
      'test("fixes org/repo#99 regression", () => {});',
      'test.each([1, 2])("läuft", () => {});',
      'test.skip("wird übersprungen", () => {});',
      'test("handles &#123; entities and #1 markers", () => {});',
      'test("handles Müller GmbH lookup", () => {});',
      "test(`template @{name} der Fall`, () => {});",
    ].join("\n"),
  });

  test("flags German titles and issue references", () => {
    expect(lineNumbers(findings, "a.test.ts")).toEqual([2, 3, 4, 5, 6, 7, 10]);
  });

  test("reports warnings, not errors", () => {
    expect(new Set(findings.map((f) => f.severity))).toEqual(new Set(["warning"]));
  });
});

describe("no-create-test-dispatcher plugin", () => {
  const findings = lintWithPlugin("no-create-test-dispatcher", {
    "a.integration.ts": "const d = createTestDispatcher(app);\nconst s = await setupTestStack();",
  });

  test("flags createTestDispatcher calls", () => {
    expect(lineNumbers(findings, "a.integration.ts")).toEqual([1]);
  });
});

describe("no-same-folder-barrel-import plugin", () => {
  const findings = lintWithPlugin("no-same-folder-barrel-import", {
    "a.ts": [
      'import { x } from "./index";',
      'import { y } from "./index.ts";',
      'import { z } from ".";',
      'import { w } from "./thing";',
      'import { v } from "../index";',
    ].join("\n"),
  });

  test("flags imports through the own folder barrel only", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3]);
  });
});

// Hosts and interpolation markers are assembled so this file does not trip the plugins and rules it tests.
const googleFontsHost = ["fonts", "googleapis", "com"].join(".");
const gstaticFontsHost = ["fonts", "gstatic", "com"].join(".");

describe("no-external-font-cdn plugins", () => {
  test("flags font CDN hosts in string literals", () => {
    const findings = lintWithPlugin("no-external-font-cdn", {
      "a.ts": [
        `const a = "https://${googleFontsHost}/css2?family=Inter";`,
        `const b = \`https://${gstaticFontsHost}/s/inter/@{v}.woff2\`;`,
        'const c = "https://example.com/font.woff2";',
      ].join("\n"),
    });
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2]);
  });

  test("flags font CDN hosts in stylesheets", () => {
    const findings = lintWithPlugin("no-external-font-cdn-css", {
      "a.css": [
        `@import url("https://${googleFontsHost}/css2?family=Inter");`,
        `@font-face { src: url("https://${gstaticFontsHost}/s/inter.woff2"); }`,
        '@font-face { src: url("/fonts/inter.woff2"); }',
      ].join("\n"),
    });
    expect(lineNumbers(findings, "a.css")).toEqual([1, 2]);
  });
});

describe("no-direct-fetch plugin", () => {
  const findings = lintWithPlugin("no-direct-fetch", {
    "a.ts": [
      "await fetch(url);",
      "await globalThis.fetch(url, { method: 'POST' });",
      "await window.fetch(url);",
      'await fetch("/api/session");',
      "await fetch(`/api/@{id}`);",
      'await fetch("//evil.example/x");',
      "await egress(policy)(url);",
      "const handler: typeof fetch = impl;",
      'await fetch("/\\\\/attacker.example/x");',
      "await fetch(`/@{host}/x`);",
      'await fetch("/" + host);',
      'await fetch("https://example.com");',
    ].join("\n"),
  });

  test("flags raw fetch calls but not same-origin paths or type references", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3, 6, 9, 10, 11, 12]);
  });
});

describe("es-literal-writes-tests plugin", () => {
  const findings = lintWithPlugin("es-literal-writes-tests", {
    "a.integration.test.ts": [
      'const a = "INSERT INTO kumiko_events (id) VALUES (1)";',
      'const b = "update \\"kumiko_events\\" set payload = 1";',
      'const c = "CREATE TABLE read_tenant_memberships (id uuid)";',
      'const d = "SELECT * FROM kumiko_events";',
      'const e = "DELETE FROM kumiko_events";',
      'const f = "INSERT INTO kumiko_snapshots (id) VALUES (1)";',
      'const g = "INSERT INTO KUMIKO_EVENTS (id) VALUES (1)";',
    ].join("\n"),
  });

  test("flags event and membership seeding by hand-written SQL, not reads or cleanup", () => {
    expect(lineNumbers(findings, "a.integration.test.ts")).toEqual([1, 2, 3, 7]);
  });
});

describe("restricted-event-store-symbols plugin", () => {
  const findings = lintWithPlugin("restricted-event-store-symbols", {
    "a.ts": [
      'import { getUnscopedAggregateStreamMaxVersion } from "x";',
      'import { createTenantDataDestroyDb as sneaky } from "x";',
      'export { appendEventInTenantDb } from "x";',
      'import * as es from "x";',
      "export const v = es.getUnscopedAggregateStreamTenant(1);",
      'import { getStreamVersion } from "x";',
      "export const ok = es.somethingElse(getStreamVersion);",
    ].join("\n"),
  });

  test("flags imports, aliased imports, re-exports and namespace access", () => {
    expect(lineNumbers(findings, "a.ts")).toEqual([1, 2, 3, 5]);
  });
});

describe("no-skipped-or-retried-tests plugin", () => {
  const findings = lintWithPlugin("no-skipped-or-retried-tests", {
    "a.test.ts": [
      'test.skip("a", () => {});',
      "describe.skip(`b`, () => {});",
      'test.skip(true, "environment reason");',
      'test.skipIf(!ready)("c", () => {});',
      'test("d", () => {}, { retry: 2 });',
      'test("e", () => {}, { retry: 0 });',
      'test("f", { retry: 3 }, () => {});',
      'test("g", () => {}, { timeout: 5, retry: 2 });',
      "const info = { retry: 1 };",
      'test("h", () => {});',
    ].join("\n"),
  });

  test("flags unconditional skips and retry counts, not conditional gates or retry data", () => {
    expect(lineNumbers(findings, "a.test.ts")).toEqual([1, 2, 5, 7, 8]);
  });
});

describe("no-css-properties-type plugin", () => {
  const findings = lintWithPlugin("no-css-properties-type", {
    "a.tsx": [
      'import type React from "react";',
      "export const a: React.CSSProperties = { top: 1 };",
      "export const b: CSSProperties = {};",
      "export const c: Partial<React.CSSProperties> = {};",
      "export const d: OtherProperties = {};",
    ].join("\n"),
  });

  test("flags CSSProperties type references, plain and namespaced", () => {
    expect(lineNumbers(findings, "a.tsx")).toEqual([2, 3, 4]);
  });
});
