// Heuristik für die Watcher-Loop: server-side Änderungen brauchen
// Process-Restart (Bun cached Module-Imports), Client-Side reicht
// Hot-Reload, Tests/non-TS sollen den Watcher gar nicht triggern.
// Wenn die Klassifikation drift bekommt, kommen entweder unnötige
// Restarts (DX schlecht) oder echte Schema-Änderungen schlagen
// nicht durch (UX broken). Beide sind teuer — daher pinnen wir.

import { describe, expect, test } from "vitest";
import { classifyChange } from "../create-kumiko-server";

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
    expect(classifyChange("/abs/samples/foo/src/feature.integration.ts")).toBe("ignore");
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
});
