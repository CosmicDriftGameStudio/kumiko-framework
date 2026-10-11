import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { buildHandbuch } from "../build";
import { buildInfoLines, collectBuildInfo, formatGermanDateTime } from "../buildinfo";
import { type HandbuchConfig, parseHandbuchConfig, restrictToLocale } from "../config";
import { discoverFlowShots, splitStepSections } from "../flows";
import { buildModel, discoverMatrix, parseFrontmatter, parseList } from "../model";
import {
  buildUiIndex,
  extractBoldTerms,
  extractUiStrings,
  extractYamlStrings,
  findMissingUiTerms,
} from "../uistrings";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "handbuch-test-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Buffer): string {
  const target = join(workDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

async function writePng(relativePath: string): Promise<void> {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  write(relativePath, png);
}

function configFor(overrides: Partial<HandbuchConfig> = {}): HandbuchConfig {
  return parseHandbuchConfig({
    title: "Test Handbuch",
    repo: "app",
    locales: ["de", "en"],
    defaultLocale: "de",
    groups: [
      { id: "eins", label: "Eins" },
      { id: "zwei", label: "Zwei" },
    ],
    textsDir: "handbuch/{locale}",
    shotsDir: "shots",
    screens: [
      { id: "alpha", title: "Alpha", group: "eins" },
      { id: "beta", title: "Beta", group: "eins" },
      { id: "gamma", title: "Gamma", group: "zwei" },
      { id: "delta", title: "Delta", group: "zwei" },
    ],
    ...overrides,
  });
}

describe("frontmatter", () => {
  test("parses keys, strips quotes and returns the body", () => {
    const { data, body } = parseFrontmatter(
      '---\ntitel: "Kontakte"\nscreenId: contact-list\nprozesse: [a, "b"]\n---\n\n# H\ntext',
    );
    expect(data).toEqual({
      titel: "Kontakte",
      screenId: "contact-list",
      prozesse: '[a, "b"]',
    });
    expect(body).toBe("\n# H\ntext");
    expect(parseList(data["prozesse"])).toEqual(["a", "b"]);
  });

  test("a file without frontmatter is returned as body", () => {
    expect(parseFrontmatter("# nur Text")).toEqual({
      data: {},
      body: "# nur Text",
    });
  });
});

describe("config validation", () => {
  test("rejects a defaultLocale outside locales", () => {
    expect(() => configFor({ defaultLocale: "fr" })).toThrow();
  });

  test("restrictToLocale narrows locales and defaultLocale together and rejects unknown ones", () => {
    const config = configFor({
      locales: ["de", "en", "es"],
      defaultLocale: "de",
    });
    const narrowed = restrictToLocale(config, "en");
    expect(narrowed.locales).toEqual(["en"]);
    expect(narrowed.defaultLocale).toBe("en");
    expect(() => restrictToLocale(config, "fr")).toThrow();
  });

  test("rejects screens and screensModule together", () => {
    expect(() =>
      configFor({
        screensModule: {
          path: "x.ts",
          export: "X",
          idKey: "id",
          titleKey: "t",
          groupKey: "g",
        },
      }),
    ).toThrow();
  });
});

describe("matrix discovery", () => {
  test("finds light-theme shots per locale and ignores dark and unknown locales", async () => {
    await writePng("shots/alpha/de/default-light/desktop.png");
    await writePng("shots/alpha/de/default-light/mobile.png");
    await writePng("shots/alpha/de/default-dark/tablet.png");
    await writePng("shots/alpha/fr/default-light/desktop.png");
    const matrix = discoverMatrix(join(workDir, "shots"), ["de", "en"]);
    expect([...matrix.keys()]).toEqual(["alpha"]);
    const alpha = matrix.get("alpha")?.get("de");
    expect(Object.keys(alpha ?? {}).sort()).toEqual(["desktop", "mobile"]);
    expect(matrix.get("alpha")?.has("en")).toBe(false);
  });
});

describe("gaps and grouping", () => {
  test("classifies missing text, missing image and planned screens", async () => {
    write(
      "app/handbuch/de/alpha.md",
      "---\ntitel: Alpha\nscreenId: alpha\n---\n\n# Alpha\n\n![da](vorhanden.png)\n\n![weg](fehlt.png)\n",
    );
    await writePng("app/handbuch/de/vorhanden.png");
    await writePng("shots/beta/de/default-light/desktop.png");

    const model = await buildModel(configFor(), { rootDir: workDir });

    expect(model.stats).toEqual({
      chapters: 2,
      textMissing: 1,
      imageMissing: 1,
      staleText: 0,
      planned: 2,
    });
    expect(model.planned.map((p) => p.chapter.id)).toEqual(["gamma", "delta"]);
    const alpha = model.groups[0]?.chapters.find((c) => c.id === "alpha");
    expect(alpha?.texts.get("de")?.missingImages).toEqual(["fehlt.png"]);
  });

  test("frontmatter gruppe beats the config group, unknown labels become their own group", async () => {
    write("app/handbuch/de/alpha.md", "---\ntitel: Alpha\ngruppe: Zwei\n---\ntext");
    write("app/handbuch/de/gamma.md", "---\ntitel: Gamma\ngruppe: Neu\n---\ntext");
    write("app/handbuch/de/unbekannt.md", "---\ntitel: Frei\n---\ntext");

    const model = await buildModel(configFor(), { rootDir: workDir });
    const groupOf = (id: string) =>
      model.groups.find((g) => g.chapters.some((c) => c.id === id))?.label;

    expect(groupOf("alpha")).toBe("Zwei");
    expect(groupOf("gamma")).toBe("Neu");
    expect(groupOf("unbekannt")).toBe("Weitere");
    expect(model.groups.at(-1)?.label).toBe("Weitere");
  });

  test("screens without a known config group land in Weitere", async () => {
    write("app/handbuch/de/beta.md", "---\ntitel: Beta\n---\ntext");
    const model = await buildModel(
      configFor({
        screens: [{ id: "beta", title: "Beta", group: "gibtsnicht" }],
      }),
      { rootDir: workDir },
    );
    expect(model.groups.map((g) => g.label)).toEqual(["Weitere"]);
  });
});

describe("build output", () => {
  test("writes index.html with markers, JPEGs and locale fallback, and clears the out dir", async () => {
    write(
      "app/handbuch/de/alpha.md",
      "---\ntitel: Alpha\nscreenId: alpha\n---\n\n![x](bild.png)\n\nHallo Welt",
    );
    write("app/handbuch/de/gamma.md", "---\ntitel: Gamma\n---\n\n![weg](nix.png)");
    await writePng("app/handbuch/de/bild.png");
    await writePng("shots/alpha/de/default-light/desktop.png");
    await writePng("shots/alpha/en/default-light/mobile.png");
    await writePng("shots/beta/de/default-light/tablet.png");
    const outDir = join(workDir, "out");
    write("out/stale.txt", "old");

    const result = await buildHandbuch(configFor(), {
      rootDir: workDir,
      outDir,
    });

    expect(existsSync(join(outDir, "stale.txt"))).toBe(false);
    expect(result.stats).toEqual({
      chapters: 3,
      textMissing: 1,
      imageMissing: 1,
      staleText: 0,
      planned: 1,
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain("Text fehlt");
    expect(html).toContain("Bild fehlt");
    expect(html).toContain("Geplante Masken");
    expect(html).toContain("Text in dieser Sprache fehlt, angezeigt wird DE.");
    expect(html).toContain("shots/alpha/de/desktop.webp");
    expect(html).toContain("shots/alpha/en/mobile.webp");
    expect(html).not.toContain("data:image");
    const webp = await sharp(join(outDir, "shots/alpha/de/desktop.webp")).metadata();
    expect(webp.format).toBe("webp");
    expect(existsSync(join(outDir, "shots/inline/de/bild.webp"))).toBe(true);
  });
});

describe("build info", () => {
  const fixedNow = { year: 2026, month: 9, day: 30, hour: 14, minute: 5 };

  test("formats the date German and absolute", () => {
    expect(formatGermanDateTime(fixedNow)).toBe("30.09.2026, 14:05");
  });

  test("reports app version, resolved framework version and a differing pin", () => {
    write(
      "app/package.json",
      JSON.stringify({
        version: "1.2.3",
        dependencies: { "@cosmicdrift/kumiko-framework": "^0.325.2" },
      }),
    );
    write(
      "app/node_modules/@cosmicdrift/kumiko-framework/package.json",
      JSON.stringify({
        name: "@cosmicdrift/kumiko-framework",
        version: "0.326.1",
      }),
    );
    const info = collectBuildInfo(join(workDir, "app"), fixedNow);
    expect(info.git).toBeUndefined();
    expect(buildInfoLines(info)).toEqual([
      "App 1.2.3",
      "Kumiko 0.326.1 (Pin ^0.325.2)",
      "Stand 30.09.2026, 14:05",
    ]);
  });

  test("omits the pin when it equals the resolved version and omits a missing framework", () => {
    write(
      "app/package.json",
      JSON.stringify({
        version: "1.0.0",
        dependencies: { "@cosmicdrift/kumiko-framework": "0.5.0" },
      }),
    );
    write(
      "app/node_modules/@cosmicdrift/kumiko-framework/package.json",
      JSON.stringify({ version: "0.5.0" }),
    );
    expect(buildInfoLines(collectBuildInfo(join(workDir, "app"), fixedNow))[1]).toBe(
      "Kumiko 0.5.0",
    );
    rmSync(join(workDir, "app/node_modules"), { recursive: true });
    expect(
      buildInfoLines(collectBuildInfo(join(workDir, "app"), fixedNow)).join("|"),
    ).not.toContain("Kumiko");
  });

  test("renders the info into the sidebar of the built page", async () => {
    write("app/package.json", JSON.stringify({ version: "9.9.9" }));
    const outDir = join(workDir, "out");
    await buildHandbuch(configFor(), {
      rootDir: workDir,
      outDir,
      now: fixedNow,
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain("App 9.9.9");
    expect(html).toContain("Stand 30.09.2026, 14:05");
  });
});

describe("texts override", () => {
  test("reads <dir>/<locale>/<screenId>.md instead of the configured textsDir", async () => {
    write("app/handbuch/de/alpha.md", "---\ntitel: Aus Config\n---\ntext");
    write("override/de/alpha.md", "---\ntitel: Aus Override\n---\ntext");
    const model = await buildModel(configFor(), {
      rootDir: workDir,
      textsDir: join(workDir, "override"),
    });
    const alpha = model.groups.flatMap((g) => g.chapters).find((c) => c.id === "alpha");
    expect(alpha?.texts.get("de")?.title).toBe("Aus Override");
  });
});

describe("ui strings", () => {
  test("extracts labelled and block strings including escapes and skips interpolated templates", () => {
    const source = [
      "export const K = {",
      '  "a.b": { de: "Speichern", en: \'It\\\'s done\', es: `Hecho` },',
      '  "c": { de: "Zeile \\"zitiert\\" {count}", en: `x ${1}` },',
      "};",
    ].join("\n");
    const found = extractUiStrings(source, ["de", "en", "es"]);
    expect(found.get("de")).toEqual(["Speichern", 'Zeile "zitiert" {count}']);
    expect(found.get("en")).toEqual(["It's done"]);
    expect(found.get("es")).toEqual(["Hecho"]);
  });

  test("reads flat maps with a fixed locale and locale blocks", () => {
    const flat = extractUiStrings(
      'export const B = {\n  "k.save": "Speichern",\n  "k.long":\n    "Lang",\n};',
      ["de"],
      "de",
    );
    expect(flat.get("de")).toEqual(["Speichern", "Lang"]);
    const blocks = extractUiStrings(
      'const T = {\n  en: {\n    "k.save": "Save",\n  },\n  de: {\n    "k.save": "Speichern",\n  },\n};',
      ["de", "en"],
    );
    expect(blocks.get("en")).toEqual(["Save"]);
    expect(blocks.get("de")).toEqual(["Speichern"]);
  });

  const index = buildUiIndex(
    new Map([
      [
        "de",
        ["Kontakt anlegen", "„Speichern“…", "Schritt {current} von {total}", "Mietvertrag prüfen"],
      ],
    ]),
  );

  test("bold terms match exactly, as whole words inside a string and via placeholders", () => {
    const md = "**kontakt  anlegen** und **Speichern** und **Schritt 2 von 5** und **Mietvertrag**";
    expect(findMissingUiTerms(md, "de", index, [])).toEqual([]);
  });

  test("bold terms without a counterpart are reported, partial words do not match", () => {
    const md = "**Vertrag** **Löschen** **Kontakt anleg**";
    expect(findMissingUiTerms(md, "de", index, [])).toEqual([
      "Vertrag",
      "Löschen",
      "Kontakt anleg",
    ]);
  });

  test("a placeholder-only string does not act as a wildcard for everything", () => {
    const onlyPlaceholder = buildUiIndex(new Map([["de", ["{count}", "Speichern"]]]));
    expect(findMissingUiTerms("**Irgendwas**", "de", onlyPlaceholder, [])).toEqual(["Irgendwas"]);
  });

  test("ui-ignore and italics are not checked, locales without strings are skipped", () => {
    const md = "*Betonung* und **Frei** und _auch_";
    expect(findMissingUiTerms(md, "de", index, ["frei"])).toEqual([]);
    expect(findMissingUiTerms("**Nix**", "en", index, [])).toEqual([]);
    expect(extractBoldTerms("*a* **b** ```\n**code**\n```")).toEqual(["b"]);
    expect(extractBoldTerms("**Neu\nerzeugen** und **x\n\ny**")).toEqual(["Neu erzeugen"]);
  });

  test("marks a chapter as stale from real uiStrings globs and frontmatter ui-ignore", async () => {
    write("app/src/i18n.ts", 'export const T = { "x": { de: "Speichern", en: "Save" } };');
    write("app/handbuch/de/alpha.md", "---\ntitel: A\n---\n**Speichern** **Weg**");
    write(
      "app/handbuch/de/beta.md",
      "---\ntitel: B\nui-ignore: [Weg]\n---\n**Speichern** **Weg** *kursiv*",
    );
    const model = await buildModel(configFor({ uiStrings: ["src/**/i18n.ts"] }), {
      rootDir: workDir,
    });
    const chapters = model.groups.flatMap((g) => g.chapters);
    expect(chapters.find((c) => c.id === "alpha")?.texts.get("de")?.staleTerms).toEqual(["Weg"]);
    expect(chapters.find((c) => c.id === "beta")?.texts.get("de")?.staleTerms).toEqual([]);
    expect(model.stats.staleText).toBe(1);
    const off = await buildModel(configFor(), { rootDir: workDir });
    expect(off.stats.staleText).toBe(0);
  });
});

describe("lightbox", () => {
  test("links screenshots to a large WebP that is written next to the small one", async () => {
    await writePng("shots/alpha/de/default-light/desktop.png");
    const outDir = join(workDir, "out");
    await buildHandbuch(configFor(), { rootDir: workDir, outDir });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('data-large="shots/alpha/de/desktop.large.webp"');
    expect(html).toContain('href="shots/alpha/de/desktop.large.webp"');
    expect(existsSync(join(outDir, "shots/alpha/de/desktop.large.webp"))).toBe(true);
    expect(html).toContain('<dialog id="lightbox"');
  });

  test("--no-large skips the large files and the lightbox uses the normal image", async () => {
    await writePng("shots/alpha/de/default-light/desktop.png");
    const outDir = join(workDir, "out");
    await buildHandbuch(configFor(), {
      rootDir: workDir,
      outDir,
      withLarge: false,
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('data-large="shots/alpha/de/desktop.webp"');
    expect(existsSync(join(outDir, "shots/alpha/de/desktop.large.webp"))).toBe(false);
    expect(existsSync(join(outDir, "shots/alpha/de/desktop.webp"))).toBe(true);
  });
});

describe("web flow sources", () => {
  const shot = (flow: string, step: string, locale: string, vp: string) =>
    `web/images/${flow}/${step}--${locale}--${vp}--abc123.png`;

  async function seedWeb(): Promise<void> {
    for (const locale of ["de", "en"]) {
      await writePng(shot("offentliche-seiten", "01-landing", locale, "desktop"));
      await writePng(shot("offentliche-seiten", "01-landing", locale, "mobile"));
      await writePng(shot("signup", "02-formular", locale, "desktop"));
      await writePng(shot("signup", "10-fertig", locale, "desktop"));
      await writePng(shot("signup", "02-formular", locale, "mobile"));
    }
    write("web/handbuch/de/web-ablauf-signup.md", "Intro\n\n## formular\n\nFormtext\n");
    write("web/src/content/x/de.yaml", 'title: "Hallo Welt"\n');
  }

  const webConfig = () =>
    configFor({
      screens: [],
      flowSources: [
        {
          repo: "web",
          textsDir: "handbuch/{locale}",
          shotsDir: "web",
          pageFlows: ["offentliche-seiten"],
          pageGroup: { id: "seiten", label: "Seiten" },
          flowGroup: { id: "ablaeufe", label: "Abläufe" },
          flowTitles: { signup: "Registrierung" },
          uiStringsByLocale: { de: ["src/content/**/de.yaml"] },
        },
      ],
    });

  test("discoverFlowShots sorts steps numerically and tolerates a missing tablet", async () => {
    await seedWeb();
    const flows = discoverFlowShots(join(workDir, "web"), ["de", "en"]);
    const steps = flows.get("signup") ?? [];
    expect(steps.map((step) => step.slug)).toEqual(["formular", "fertig"]);
    const first = steps[0]?.shots.get("de");
    expect(first?.desktop).toBeDefined();
    expect(first?.tablet).toBeUndefined();
    expect(flows.has("offentliche-seiten")).toBe(true);
  });

  test("splitStepSections pulls step sections out of the intro", () => {
    const { intro, sections } = splitStepSections(
      "Intro\n\n## formular\n\nFormtext\n\n## Sonst\n\nBleibt",
      new Set(["formular"]),
    );
    expect(sections.get("formular")).toContain("Formtext");
    expect(intro).toContain("Sonst");
    expect(intro).not.toContain("Formtext");
  });

  test("model creates page and flow chapters in their groups", async () => {
    await seedWeb();
    const model = await buildModel(webConfig(), { rootDir: workDir });
    const page = model.groups.flatMap((g) => g.chapters).find((c) => c.id === "web-seite-landing");
    const flow = model.groups.flatMap((g) => g.chapters).find((c) => c.id === "web-ablauf-signup");
    expect(page?.groupId).toBe("seiten");
    expect(flow?.groupId).toBe("ablaeufe");
    expect(flow?.screenTitle).toBe("Registrierung");
    expect(flow?.steps?.length).toBe(2);
    expect(model.groups.map((g) => g.id)).toEqual(expect.arrayContaining(["seiten", "ablaeufe"]));
  });

  test("build renders steps, limits viewports and shows the web version", async () => {
    await seedWeb();
    write("web/package.json", '{"name":"web","version":"1.2.3"}');
    const outDir = join(workDir, "out");
    await buildHandbuch(webConfig(), {
      rootDir: workDir,
      outDir,
      withLarge: false,
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('class="step"');
    expect(html).toContain("Formtext");
    expect(html).toContain("web 1.2.3");
    expect(html).toContain('data-vps="desktop mobile"');
  });

  test("en build translates chrome, groups, flow and step titles", async () => {
    await seedWeb();
    const config = restrictToLocale(webConfig(), "en");
    config.translations = {
      en: {
        title: "Test manual",
        groups: { seiten: "Pages", ablaeufe: "Flows" },
        flows: { signup: "Registration" },
        steps: { formular: "Form" },
      },
    };
    const fixedNow = { year: 2026, month: 9, day: 30, hour: 14, minute: 5 };
    const outDir = join(workDir, "out-en");
    await buildHandbuch(config, {
      rootDir: workDir,
      outDir,
      withLarge: false,
      now: fixedNow,
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    for (const english of [
      "Overview",
      "<title>Test manual</title>",
      "Chapters",
      "Text missing",
      "Pages",
      "Flows",
      "Registration",
      "<h3>Form</h3>",
      "Built 2026-09-30 14:05",
      "Mobile",
    ])
      expect(html).toContain(english);
    for (const german of [
      "Übersicht",
      "Kapitel",
      "Text fehlt",
      "Abläufe",
      "Registrierung",
      "<h3>Formular</h3>",
      "Stand ",
      "Mobil<",
    ])
      expect(html).not.toContain(german);
  });

  test("raw md and inline astro strings feed the stale check; web texts dir overrides", async () => {
    await seedWeb();
    write("web/src/content/x/de.md", "Klick auf Weiter geht es.\n");
    write(
      "web/src/components/A.astro",
      "const t = {\n  de: {\n    go: 'Los gehts',\n  },\n  en: {\n    go: 'Go on',\n  },\n};",
    );
    write("other/de/web-ablauf-signup.md", "**Weiter** und **Los gehts** und **Nirgends**");
    const config = webConfig();
    const source = config.flowSources?.[0];
    if (!source) throw new Error("flow source missing");
    source.uiStringsByLocale = { de: ["src/content/**/de.md"] };
    source.uiStringFiles = ["src/**/*.astro"];
    const model = await buildModel(config, {
      rootDir: workDir,
      flowTextsDir: join(workDir, "other"),
    });
    const flow = model.groups.flatMap((g) => g.chapters).find((c) => c.id === "web-ablauf-signup");
    expect(flow?.texts.get("de")?.staleTerms).toEqual(["Nirgends"]);
  });

  test("extractYamlStrings returns scalar values", () => {
    const values = extractYamlStrings('title: "Hallo Welt"\nlist:\n  - Eins zwei\n');
    expect(values).toContain("Hallo Welt");
    expect(values).toContain("Eins zwei");
  });
});
