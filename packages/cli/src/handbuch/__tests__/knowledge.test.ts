import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli } from "../../index";
import { buildHandbuch } from "../build";
import { type HandbuchConfig, parseHandbuchConfig } from "../config";
import { buildKnowledge, stripMarkdownImages } from "../knowledge";
import { buildModel, parseFrontmatterList } from "../model";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "handbuch-knowledge-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const target = join(workDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function configFor(overrides: Partial<HandbuchConfig> = {}): HandbuchConfig {
  return parseHandbuchConfig({
    title: "Wissen Handbuch",
    repo: "app",
    locales: ["de", "en"],
    defaultLocale: "de",
    groups: [{ id: "eins", label: "Eins" }],
    textsDir: "handbuch/{locale}",
    screens: [{ id: "alpha", title: "Alpha", group: "eins" }],
    ...overrides,
  });
}

function writeFixture(): void {
  write(
    "app/handbuch/de/alpha.md",
    "---\ntitel: Alpha\nscreenId: alpha\n---\n\n# Alpha\n\nText vor dem Bild.\n\n![Bild](alpha.png)\n\nText nach dem Bild.\n",
  );
  write("app/handbuch/en/alpha.md", "---\ntitel: Alpha EN\nscreenId: alpha\n---\n\nEnglish text.");
  write(
    "app/handbuch/de/prozesse/mieter-hinzufuegen.md",
    [
      "---",
      "titel: Mieter hinzufügen",
      "gruppe: aufgaben",
      "start: ai-orchestration:write:start-tenant-add",
      "fragen:",
      '  - "Wie füge ich einen Mieter zu einem Vertrag hinzu?"',
      "  - Wie ändere ich einen Mietvertrag?",
      "masken:",
      "  - alpha",
      "  - lease-detail",
      "---",
      "",
      "# Mieter hinzufügen",
      "",
      "## Dein Problem",
      "",
      "Ein Mieter kommt dazu.",
      "",
      "![Schritt](schritt.png)",
      "",
      "## So löst du es",
      "",
      "Änderung anlegen.",
    ].join("\n"),
  );
  write(
    "app/handbuch/en/prozesse/mieter-hinzufuegen.md",
    "---\ntitel: Add a tenant\nfragen: [How do I add a tenant?]\nmasken: [alpha]\n---\n\n## Your problem\n\nA tenant joins.",
  );
}

const processConfig = () => configFor({ processTextsDir: "handbuch/{locale}/prozesse" });

describe("parseFrontmatterList", () => {
  test("reads block lists, inline lists and strips quotes", () => {
    const raw = '---\ntitel: T\nfragen:\n  - "Eins, zwei?"\n  - Drei\nmasken: [a, b]\n---\nbody';
    expect(parseFrontmatterList(raw, "fragen")).toEqual(["Eins, zwei?", "Drei"]);
    expect(parseFrontmatterList(raw, "masken")).toEqual(["a", "b"]);
    expect(parseFrontmatterList(raw, "fehlt")).toEqual([]);
    expect(parseFrontmatterList("kein frontmatter", "fragen")).toEqual([]);
  });
});

describe("process pages in the model", () => {
  test("form their own group and never collide with screen ids", async () => {
    writeFixture();
    const model = await buildModel(processConfig(), { rootDir: workDir });
    const group = model.groups.find((entry) => entry.id === "aufgaben");
    expect(group?.label).toBe("Aufgaben");
    const process = group?.chapters.find((chapter) => chapter.id === "prozess-mieter-hinzufuegen");
    expect(process?.isProcess).toBe(true);
    expect(process?.texts.get("de")?.questions).toEqual([
      "Wie füge ich einen Mieter zu einem Vertrag hinzu?",
      "Wie ändere ich einen Mietvertrag?",
    ]);
    expect(process?.texts.get("en")?.screens).toEqual(["alpha"]);
    expect(model.groups.find((entry) => entry.id === "eins")?.chapters.map((c) => c.id)).toEqual([
      "alpha",
    ]);
  });

  test("a process page with a term missing from the UI strings is reported as stale", async () => {
    writeFixture();
    write("app/src/i18n.ts", 'export const T = { "x": { de: "Speichern", en: "Save" } };');
    write(
      "app/handbuch/de/prozesse/alt.md",
      "---\ntitel: Alt\n---\n\n**Speichern** und **Verschwunden**",
    );
    const model = await buildModel(
      { ...processConfig(), uiStrings: ["src/**/i18n.ts"] },
      { rootDir: workDir },
    );
    const process = model.groups
      .flatMap((group) => group.chapters)
      .find((chapter) => chapter.id === "prozess-alt");
    expect(process?.texts.get("de")?.staleTerms).toEqual(["Verschwunden"]);
  });

  test("the html shows the process group and its pages", async () => {
    writeFixture();
    const outDir = join(workDir, "out");
    await buildHandbuch(processConfig(), { rootDir: workDir, outDir });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain("Aufgaben");
    expect(html).toContain("Mieter hinzufügen");
  });
});

describe("without processTextsDir", () => {
  test("a missing process directory leaves the built html byte-identical", async () => {
    writeFixture();
    write("app/package.json", JSON.stringify({ version: "1.0.0" }));
    const now = { year: 2026, month: 11, day: 7, hour: 9, minute: 0 };
    const baselineDir = join(workDir, "baseline");
    const withKeyDir = join(workDir, "with-key");
    await buildHandbuch(configFor(), { rootDir: workDir, outDir: baselineDir, now });
    await buildHandbuch(configFor({ processTextsDir: "gibt-es-nicht/{locale}" }), {
      rootDir: workDir,
      outDir: withKeyDir,
      now,
    });
    expect(readFileSync(join(withKeyDir, "index.html"), "utf8")).toBe(
      readFileSync(join(baselineDir, "index.html"), "utf8"),
    );
  });

  test("the model has no process chapters and no process group", async () => {
    writeFixture();
    const model = await buildModel(configFor(), { rootDir: workDir });
    expect(model.groups.some((group) => group.id === "aufgaben")).toBe(false);
    expect(model.groups.flatMap((group) => group.chapters).some((c) => c.isProcess)).toBe(false);
  });
});

describe("knowledge export", () => {
  test("lists processes before screens per locale, with questions, screens and no images", async () => {
    writeFixture();
    const model = await buildModel(processConfig(), { rootDir: workDir });
    const knowledge = buildKnowledge(model);

    expect(knowledge.defaultLocale).toBe("de");
    expect(Object.keys(knowledge.locales)).toEqual(["de", "en"]);
    const de = knowledge.locales["de"] ?? [];
    expect(de.map((page) => [page.id, page.kind])).toEqual([
      ["prozess-mieter-hinzufuegen", "process"],
      ["alpha", "screen"],
    ]);
    expect(de[0]?.questions).toHaveLength(2);
    expect(de[0]?.screens).toEqual(["alpha", "lease-detail"]);
    expect(de[0]?.bodyMd).toContain("## Dein Problem");
    expect(de[0]?.bodyMd).not.toContain("![");
    expect(de[1]?.screens).toEqual(["alpha"]);
    expect(de[1]?.bodyMd).toBe("Text vor dem Bild.\n\nText nach dem Bild.");
    expect(knowledge.locales["en"]?.[1]?.title).toBe("Alpha EN");
  });

  test("start appears on a process page that names it and is absent everywhere else", async () => {
    writeFixture();
    const knowledge = buildKnowledge(await buildModel(processConfig(), { rootDir: workDir }));
    const de = knowledge.locales["de"] ?? [];
    const en = knowledge.locales["en"] ?? [];

    expect(de[0]?.start).toBe("ai-orchestration:write:start-tenant-add");
    expect(JSON.stringify(de[1])).not.toContain('"start"');
    expect(JSON.stringify(en[0])).not.toContain('"start"');
    expect("start" in (en[0] ?? {})).toBe(false);
  });

  test("the command writes identical bytes on every run", async () => {
    writeFixture();
    write("handbuch.json", JSON.stringify(processConfig()));
    const first = join(workDir, "out", "a.json");
    const second = join(workDir, "out", "b.json");
    const lines: string[] = [];
    const out = {
      log: (line: string) => lines.push(line),
      err: (line: string) => lines.push(line),
    };

    for (const target of [first, second]) {
      const code = await runCli({
        argv: ["handbuch", "knowledge", "handbuch.json", "--root", workDir, "--out", target],
        out,
      });
      expect(code).toBe(0);
    }

    expect(readFileSync(first, "utf8")).toBe(readFileSync(second, "utf8"));
    expect(JSON.parse(readFileSync(first, "utf8")).locales.de).toHaveLength(2);
  });

  test("a missing --out is a usage error", async () => {
    write("handbuch.json", JSON.stringify(processConfig()));
    const errors: string[] = [];
    const code = await runCli({
      argv: ["handbuch", "knowledge", "handbuch.json", "--root", workDir],
      out: { log: () => undefined, err: (line: string) => errors.push(line) },
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Missing --out");
  });

  test("stripMarkdownImages removes inline images and collapses the gap", () => {
    expect(stripMarkdownImages("a ![x](y.png) b\n\n![z](w.png)\n\nc")).toBe("a  b\n\nc");
  });
});
