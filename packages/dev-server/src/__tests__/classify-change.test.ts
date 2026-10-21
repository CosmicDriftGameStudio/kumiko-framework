// Heuristic for the watcher loop: server-side changes require a
// process restart (Bun caches module imports), while client-side changes only need
// hot-reload; tests and non-TS files should not trigger the watcher at all.
// If the classification drifts, either unnecessary restarts hurt DX or real schema
// changes fail to propagate (UX is broken). Both are costly, so we pin this behavior.

import { describe, expect, test } from "bun:test";
import { classifyChange, classifyWatchedChange } from "../create-kumiko-server.ts";

describe("classifyChange", () => {
  test("server-side feature.ts → restart", () => {
    expect(classifyChange("/abs/samples/foo/src/features/items/feature.ts")).toBe("restart");
  });

  test("server-side schema-Datei → restart", () => {
    expect(classifyChange("/abs/samples/foo/src/features/items/schema/item.ts")).toBe("restart");
  });

  test("server-side bin/server.ts → restart", () => {
    expect(classifyChange("/abs/samples/foo/bin/server.ts")).toBe("restart");
  });

  test("client-side web/index.ts → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/features/items/web/index.ts")).toBe("hot-reload");
  });

  test("client-side web/page.tsx → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/features/items/web/page.tsx")).toBe("hot-reload");
  });

  test("client.tsx Entry → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/app/client.tsx")).toBe("hot-reload");
  });

  test("client.ts Entry → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/app/client.ts")).toBe("hot-reload");
  });

  test("Test-Datei *.test.ts → ignore", () => {
    expect(classifyChange("/abs/samples/foo/src/feature.test.ts")).toBe("ignore");
  });

  test("Test-Datei *.test.tsx → ignore", () => {
    expect(classifyChange("/abs/samples/foo/src/component.test.tsx")).toBe("ignore");
  });

  test("__tests__/ Subdir → ignore (auch wenn die Datei selbst nicht *.test.ts heißt)", () => {
    expect(classifyChange("/abs/samples/foo/src/__tests__/test-utils.ts")).toBe("ignore");
  });

  test("Integration-Test → ignore (würde sonst Schema-Restart auslösen)", () => {
    expect(classifyChange("/abs/samples/foo/src/feature.integration.test.ts")).toBe("ignore");
  });

  test("E2E-Test → ignore", () => {
    expect(classifyChange("/abs/samples/foo/src/something.e2e.ts")).toBe("ignore");
  });

  test("CSS/JSON/sonstiges → ignore", () => {
    expect(classifyChange("/abs/samples/foo/src/styles.css")).toBe("ignore");
    expect(classifyChange("/abs/samples/foo/src/data.json")).toBe("ignore");
    expect(classifyChange("/abs/samples/foo/public/index.html")).toBe("ignore");
  });

  test("Windows-Pfad-Trenner: web\\ → hot-reload", () => {
    expect(classifyChange("C:\\abs\\samples\\foo\\src\\features\\items\\web\\page.tsx")).toBe(
      "hot-reload",
    );
  });

  // Sample conventions: publicstatus splits `/admin/` (Admin bundle) and `/public/`
  // (Public bundle). Both are client-side and must use hot-reload; otherwise every
  // bridge edit costs a restart and DB reset. Other samples may follow this pattern too.
  test("admin/-Subdir → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/admin/branding-settings.tsx")).toBe("hot-reload");
  });

  test("public/-Subdir → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/public/StatusPage.tsx")).toBe("hot-reload");
  });

  test("client/-Subdir → hot-reload", () => {
    expect(classifyChange("/abs/samples/foo/src/client/widgets.tsx")).toBe("hot-reload");
  });
});

describe("classifyWatchedChange", () => {
  const entryDir = "/abs/samples/foo/src";
  const entries = new Set([`${entryDir}/client.tsx`, `${entryDir}/client-admin.tsx`]);

  test("the entry reported relative to its own directory → hot-reload", () => {
    expect(classifyWatchedChange(entryDir, "client.tsx", entries)).toBe("hot-reload");
  });

  test("a custom-named entry → hot-reload", () => {
    expect(classifyWatchedChange(entryDir, "client-admin.tsx", entries)).toBe("hot-reload");
  });

  test("a non-entry server file next to the entry still restarts", () => {
    expect(classifyWatchedChange(entryDir, "feature.ts", entries)).toBe("restart");
  });

  test("a nested web/ file → hot-reload", () => {
    expect(classifyWatchedChange(entryDir, "web/page.tsx", entries)).toBe("hot-reload");
  });
});
