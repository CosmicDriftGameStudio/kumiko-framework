import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hydrateDemo } from "../engine/hydrate";
import { resetCliPresetsCache } from "../engine/presets";
import { listDemoIds, validateDemoSchema } from "../engine/validate-schema";

const KIT_ROOT = join(import.meta.dir, "..");

describe("demo-kit hydrate", () => {
  test("create-app hydrates to same step count as YAML manifest", () => {
    resetCliPresetsCache();
    const def = hydrateDemo({ demoId: "create-app", kitRoot: KIT_ROOT });
    expect(def.title).toBe("create-app");
    expect(def.steps.length).toBe(12);
  });

  test("editor fixtures match step bodies", () => {
    resetCliPresetsCache();
    const def = hydrateDemo({ demoId: "create-app", kitRoot: KIT_ROOT });
    const notesFixture = readFileSync(
      join(KIT_ROOT, "demos/create-app/fixtures/notes-feature.ts"),
      "utf8",
    );
    const stylesFixture = readFileSync(
      join(KIT_ROOT, "demos/create-app/fixtures/styles-brand.css"),
      "utf8",
    );
    const notesStep = def.steps.find((s) => s.kind === "editor" && s.file.endsWith("notes.ts"));
    const stylesStep = def.steps.find((s) => s.kind === "editor" && s.file.endsWith("styles.css"));
    expect(notesStep?.kind).toBe("editor");
    expect(stylesStep?.kind).toBe("editor");
    if (notesStep?.kind === "editor") {
      expect(notesStep.write).toBe(notesFixture);
    }
    if (stylesStep?.kind === "editor") {
      expect(stylesStep.write).toBe(stylesFixture);
    }
  });

  test("install preset expands with --yes when args.yes", () => {
    resetCliPresetsCache();
    const def = hydrateDemo({ demoId: "create-app", kitRoot: KIT_ROOT });
    const install = def.steps[0];
    expect(install?.kind).toBe("cli");
    if (install?.kind === "cli") {
      expect(install.type).toContain("install.sh");
      expect(install.type).toContain("--yes");
      expect(install.e2eSkip).toBe(true);
    }
  });
});

describe("demo-kit validate-schema", () => {
  test("lists create-app", () => {
    expect(listDemoIds(KIT_ROOT)).toContain("create-app");
  });

  test("create-app passes schema validation", () => {
    resetCliPresetsCache();
    const errors = validateDemoSchema("create-app", KIT_ROOT);
    expect(errors).toEqual([]);
  });
});


