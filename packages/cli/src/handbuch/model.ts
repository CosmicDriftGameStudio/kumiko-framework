import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromeFor } from "./chrome";
import type { HandbuchConfig, ScreensModuleConfig } from "./config";
import { discoverFlowShots, prettifySlug } from "./flows";
import {
  buildUiIndex,
  collectSourceUiStrings,
  collectUiStrings,
  collectYamlUiStrings,
  findMissingUiTerms,
} from "./uistrings";

export const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

export const VIEWPORT_WIDTH: Record<Viewport, number> = {
  desktop: 1600,
  tablet: 1100,
  mobile: 640,
};

const FALLBACK_GROUP_ID = "weitere";

const LIGHT_THEME_DIR = "default-light";
const LOCAL_IMAGE_REF = /\.(png|jpe?g|webp|gif|svg)$/i;

export type Group = { id: string; label: string };
export type ScreenRef = { id: string; title?: string; group?: string };
export type MatrixShots = Partial<Record<Viewport, string>>;

export type LocaleText = {
  title: string;
  bodyMd: string;
  dir: string;
  gruppe?: string;
  prozesse: string[];
  missingImages: string[];
  uiIgnore: string[];
  staleTerms: string[];
};

export type Step = {
  id: string;
  slug: string;
  label: string;
  shots: Map<string, MatrixShots>;
};

export type Chapter = {
  id: string;
  screenTitle?: string;
  groupId: string;
  texts: Map<string, LocaleText>;
  matrix: Map<string, MatrixShots>;
  steps?: Step[];
  inScreenList: boolean;
};

export type Model = {
  locales: string[];
  defaultLocale: string;
  groups: Array<Group & { chapters: Chapter[] }>;
  planned: Array<{ chapter: Chapter; groupLabel: string }>;
  stats: {
    chapters: number;
    textMissing: number;
    imageMissing: number;
    staleText: number;
    planned: number;
  };
};

export function hasText(chapter: Chapter): boolean {
  return chapter.texts.size > 0;
}

export function hasMatrix(chapter: Chapter): boolean {
  return chapter.matrix.size > 0 || (chapter.steps?.length ?? 0) > 0;
}

export function isPlanned(chapter: Chapter): boolean {
  return chapter.inScreenList && !hasText(chapter) && !hasMatrix(chapter);
}

export function isTextMissing(chapter: Chapter): boolean {
  return !hasText(chapter) && hasMatrix(chapter);
}

export function missingImagesOf(chapter: Chapter): string[] {
  return [...chapter.texts.values()].flatMap((text) => text.missingImages);
}

export function staleTermsOf(chapter: Chapter): string[] {
  return [...new Set([...chapter.texts.values()].flatMap((text) => text.staleTerms))];
}

export function chapterTitle(chapter: Chapter, locale: string, defaultLocale: string): string {
  return (
    chapter.texts.get(locale)?.title ||
    chapter.texts.get(defaultLocale)?.title ||
    chapter.screenTitle ||
    chapter.id
  );
}

export function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const block = match?.[1];
  const body = match?.[2];
  if (block === undefined || body === undefined) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const pair = line.match(/^([a-zA-Z][a-zA-Z-]*):\s*(.*)$/);
    const key = pair?.[1];
    const value = pair?.[2];
    if (key !== undefined && value !== undefined)
      data[key] = value.trim().replace(/^["']|["']$/g, "");
  }
  return { data, body };
}

export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function stripLeadingHeading(body: string): string {
  const lines = body.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index++;
  if (index < lines.length && /^#\s+/.test(lines[index] ?? "")) {
    lines.splice(index, 1);
    while (index < lines.length && (lines[index] ?? "").trim() === "") lines.splice(index, 1);
  }
  return lines.join("\n");
}

export function isLocalImageRef(href: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) && LOCAL_IMAGE_REF.test(href.split(/[?#]/)[0] ?? "")
  );
}

export function localImageRefs(body: string): string[] {
  const refs = new Set<string>();
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    const href = match[1];
    if (href && isLocalImageRef(href)) refs.add(href);
  }
  return [...refs];
}

export function resolveImagePath(dir: string, href: string): string {
  return resolve(dir, decodeURI(href.split(/[?#]/)[0] ?? href));
}

export function readTexts(textsRoot: string): Map<string, LocaleText & { id: string }> {
  const texts = new Map<string, LocaleText & { id: string }>();
  if (!existsSync(textsRoot)) return texts;
  for (const file of readdirSync(textsRoot)
    .filter((name) => name.endsWith(".md"))
    .sort()) {
    const { data, body } = parseFrontmatter(readFileSync(join(textsRoot, file), "utf8"));
    const id = data["screenId"] || basename(file, ".md");
    const bodyMd = stripLeadingHeading(body);
    texts.set(id, {
      id,
      title: data["titel"] || id,
      bodyMd,
      dir: textsRoot,
      gruppe: data["gruppe"] || undefined,
      prozesse: parseList(data["prozesse"]),
      uiIgnore: parseList(data["ui-ignore"]),
      staleTerms: [],
      missingImages: localImageRefs(bodyMd).filter(
        (href) => !existsSync(resolveImagePath(textsRoot, href)),
      ),
    });
  }
  return texts;
}

export function discoverMatrix(
  shotsDir: string,
  locales: readonly string[],
): Map<string, Map<string, MatrixShots>> {
  const matrix = new Map<string, Map<string, MatrixShots>>();
  if (!existsSync(shotsDir)) return matrix;
  for (const entry of readdirSync(shotsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const perLocale = new Map<string, MatrixShots>();
    for (const locale of locales) {
      const shots: MatrixShots = {};
      for (const viewport of VIEWPORTS) {
        const file = join(shotsDir, entry.name, locale, LIGHT_THEME_DIR, `${viewport}.png`);
        if (existsSync(file)) shots[viewport] = file;
      }
      if (Object.keys(shots).length > 0) perLocale.set(locale, shots);
    }
    if (perLocale.size > 0) matrix.set(entry.name, perLocale);
  }
  return matrix;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadScreensModule(
  rootDir: string,
  repo: string,
  source: ScreensModuleConfig,
): Promise<ScreenRef[]> {
  const modulePath = resolve(rootDir, repo, source.path);
  const loaded: unknown = await import(pathToFileURL(modulePath).href);
  const list = isRecord(loaded) ? loaded[source.export] : undefined;
  if (!Array.isArray(list)) {
    throw new Error(`${modulePath}: export "${source.export}" is not an array`);
  }
  return list.map((entry: unknown, index) => {
    if (!isRecord(entry) || typeof entry[source.idKey] !== "string") {
      throw new Error(`${modulePath}: ${source.export}[${index}] has no string "${source.idKey}"`);
    }
    const title = entry[source.titleKey];
    const group = entry[source.groupKey];
    return {
      id: String(entry[source.idKey]),
      title: typeof title === "string" ? title : undefined,
      group: typeof group === "string" ? group : undefined,
    };
  });
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type BuildModelOptions = {
  rootDir: string;
  shotsDir?: string;
  textsDir?: string;
  flowShotsDir?: string;
  flowTextsDir?: string;
  screens?: ScreenRef[];
};

type FlowChapter = {
  ref: ScreenRef;
  steps?: Step[];
  shots?: Map<string, MatrixShots>;
};

type FlowSource = NonNullable<HandbuchConfig["flowSources"]>[number];

function flowChaptersOf(
  config: HandbuchConfig,
  source: FlowSource,
  flows: Map<string, Step[]>,
): FlowChapter[] {
  const tr = config.translations?.[config.defaultLocale];
  const flowChapters: FlowChapter[] = [];
  for (const [flow, untitledSteps] of flows) {
    const steps = untitledSteps.map((step) => ({
      ...step,
      label: tr?.steps[step.slug] ?? step.label,
    }));
    if (source.pageFlows.includes(flow)) {
      for (const step of steps) {
        flowChapters.push({
          ref: {
            id: `web-seite-${step.slug}`,
            title: step.label,
            group: source.pageGroup.id,
          },
          shots: step.shots,
        });
      }
    } else {
      flowChapters.push({
        ref: {
          id: `web-ablauf-${flow}`,
          title: tr?.flows[flow] ?? source.flowTitles[flow] ?? prettifySlug(flow),
          group: source.flowGroup.id,
        },
        steps,
      });
    }
  }
  return flowChapters;
}

function collectFlowSources(
  config: HandbuchConfig,
  options: BuildModelOptions,
  textsByLocale: Map<string, Map<string, LocaleText>>,
  applyStale: (
    byLocale: Map<string, Map<string, LocaleText>>,
    uiStrings: Map<string, string[]>,
  ) => void,
  labelGroup: (group: Group) => Group,
): { flowChapters: FlowChapter[]; flowGroups: Group[] } {
  const flowChapters: FlowChapter[] = [];
  const flowGroups: Group[] = [];
  for (const source of config.flowSources ?? []) {
    const sourceRepo = resolve(options.rootDir, source.repo);
    flowGroups.push(labelGroup(source.pageGroup), labelGroup(source.flowGroup));
    const sourceTexts = new Map(
      config.locales.map((locale) => [
        locale,
        readTexts(
          options.flowTextsDir
            ? join(options.flowTextsDir, locale)
            : join(sourceRepo, source.textsDir.replace("{locale}", locale)),
        ),
      ]),
    );
    if (source.uiStringsByLocale || source.uiStringFiles) {
      const strings = collectYamlUiStrings(sourceRepo, source.uiStringsByLocale ?? {});
      const inline = collectSourceUiStrings(sourceRepo, source.uiStringFiles ?? [], config.locales);
      for (const [locale, values] of inline)
        strings.set(locale, [...(strings.get(locale) ?? []), ...values]);
      applyStale(sourceTexts, strings);
    }
    for (const [locale, texts] of sourceTexts) {
      for (const [id, text] of texts) textsByLocale.get(locale)?.set(id, text);
    }
    const flowRoot =
      options.flowShotsDir ??
      (source.shotsDir ? resolve(options.rootDir, source.shotsDir) : undefined);
    const flows = flowRoot
      ? discoverFlowShots(flowRoot, config.locales)
      : new Map<string, Step[]>();
    flowChapters.push(...flowChaptersOf(config, source, flows));
  }
  return { flowChapters, flowGroups };
}

function registerChapters(
  screens: ScreenRef[],
  flowChapters: FlowChapter[],
  textsByLocale: Map<string, Map<string, LocaleText>>,
  matrix: Map<string, Map<string, MatrixShots>>,
): {
  chapters: Map<string, Chapter>;
  sourceOrder: Map<string, number>;
  configGroupOf: Map<string, string | undefined>;
} {
  const chapters = new Map<string, Chapter>();
  const ensureChapter = (id: string): Chapter => {
    const existing = chapters.get(id);
    if (existing) return existing;
    const created: Chapter = {
      id,
      groupId: FALLBACK_GROUP_ID,
      texts: new Map(),
      matrix: new Map(),
      inScreenList: false,
    };
    chapters.set(id, created);
    return created;
  };

  const sourceOrder = new Map<string, number>();
  const configGroupOf = new Map<string, string | undefined>();
  const allScreens = [...screens, ...flowChapters.map((entry) => entry.ref)];
  allScreens.forEach((screen, index) => {
    const chapter = ensureChapter(screen.id);
    chapter.inScreenList = true;
    chapter.screenTitle = screen.title;
    sourceOrder.set(screen.id, index);
    configGroupOf.set(screen.id, screen.group);
  });
  for (const [locale, texts] of textsByLocale) {
    for (const [id, text] of texts) ensureChapter(id).texts.set(locale, text);
  }
  for (const [id, perLocale] of matrix) ensureChapter(id).matrix = perLocale;
  for (const entry of flowChapters) {
    const chapter = ensureChapter(entry.ref.id);
    if (entry.shots) chapter.matrix = entry.shots;
    if (entry.steps) chapter.steps = entry.steps;
  }
  return { chapters, sourceOrder, configGroupOf };
}

export async function buildModel(
  config: HandbuchConfig,
  options: BuildModelOptions,
): Promise<Model> {
  const repoDir = resolve(options.rootDir, config.repo);
  const screens =
    options.screens ??
    config.screens ??
    (config.screensModule
      ? await loadScreensModule(options.rootDir, config.repo, config.screensModule)
      : []);

  const textsByLocale = new Map(
    config.locales.map((locale) => [
      locale,
      readTexts(
        options.textsDir
          ? join(options.textsDir, locale)
          : join(repoDir, config.textsDir.replace("{locale}", locale)),
      ),
    ]),
  );
  const applyStale = (
    byLocale: Map<string, Map<string, LocaleText>>,
    uiStrings: Map<string, string[]>,
  ) => {
    const uiIndex = buildUiIndex(uiStrings);
    for (const [locale, texts] of byLocale) {
      for (const text of texts.values()) {
        text.staleTerms = findMissingUiTerms(text.bodyMd, locale, uiIndex, text.uiIgnore);
      }
    }
  };
  if (config.uiStrings || config.uiStringPackages) {
    applyStale(
      textsByLocale,
      collectUiStrings({
        repoDir,
        locales: config.locales,
        globs: config.uiStrings ?? [],
        packages: config.uiStringPackages ?? [],
      }),
    );
  }

  const tr = config.translations?.[config.defaultLocale];
  const labelGroup = (group: Group): Group => ({
    ...group,
    label: tr?.groups[group.id] ?? group.label,
  });
  const fallbackGroupDefault: Group = {
    id: FALLBACK_GROUP_ID,
    label: chromeFor(config.defaultLocale).fallbackGroup,
  };

  const { flowChapters, flowGroups } = collectFlowSources(
    config,
    options,
    textsByLocale,
    applyStale,
    labelGroup,
  );
  const shotsDir =
    options.shotsDir ?? (config.shotsDir ? resolve(options.rootDir, config.shotsDir) : undefined);
  const matrix = shotsDir
    ? discoverMatrix(shotsDir, config.locales)
    : new Map<string, Map<string, MatrixShots>>();

  const groups: Group[] = [...config.groups.map(labelGroup), ...flowGroups];
  const { chapters, sourceOrder, configGroupOf } = registerChapters(
    screens,
    flowChapters,
    textsByLocale,
    matrix,
  );

  const fallbackGroup = assignGroups(config, chapters, groups, configGroupOf, fallbackGroupDefault);
  return assembleModel(config, chapters, groups, sourceOrder, fallbackGroup);
}

function assignGroups(
  config: HandbuchConfig,
  chapters: Map<string, Chapter>,
  groups: Group[],
  configGroupOf: Map<string, string | undefined>,
  fallbackGroupDefault: Group,
): Group | undefined {
  const findGroup = (key: string): Group | undefined =>
    groups.find((group) => group.id === key || group.label.toLowerCase() === key.toLowerCase());
  let fallbackGroup: Group | undefined;
  for (const chapter of chapters.values()) {
    const primary = chapter.texts.get(config.defaultLocale) ?? [...chapter.texts.values()][0];
    const frontmatterKey = primary?.gruppe;
    const configKey = configGroupOf.get(chapter.id);
    let group: Group | undefined;
    if (frontmatterKey) {
      group = findGroup(frontmatterKey);
      if (!group) {
        group = {
          id: slugify(frontmatterKey) || "gruppe",
          label: frontmatterKey,
        };
        groups.push(group);
      }
    } else if (configKey) {
      group = findGroup(configKey);
    }
    if (!group) {
      fallbackGroup = findGroup(FALLBACK_GROUP_ID) ?? fallbackGroupDefault;
      group = fallbackGroup;
    }
    chapter.groupId = group.id;
  }
  return fallbackGroup;
}

function assembleModel(
  config: HandbuchConfig,
  chapters: Map<string, Chapter>,
  groups: Group[],
  sourceOrder: Map<string, number>,
  fallbackGroup: Group | undefined,
): Model {
  const collator = new Intl.Collator("de", { sensitivity: "base" });
  const titleOf = (chapter: Chapter) =>
    chapterTitle(chapter, config.defaultLocale, config.defaultLocale);
  const compare = (a: Chapter, b: Chapter): number => {
    if (config.sort === "title") return collator.compare(titleOf(a), titleOf(b));
    const rankA = sourceOrder.get(a.id);
    const rankB = sourceOrder.get(b.id);
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    return collator.compare(titleOf(a), titleOf(b));
  };

  const all = [...chapters.values()].sort(compare);
  const planned = all.filter(isPlanned);
  const documented = all.filter((chapter) => !isPlanned(chapter));

  const orderedGroups =
    fallbackGroup && !groups.includes(fallbackGroup) ? [...groups, fallbackGroup] : groups;
  const withFallbackLast = [
    ...orderedGroups.filter((group) => group.id !== FALLBACK_GROUP_ID),
    ...orderedGroups.filter((group) => group.id === FALLBACK_GROUP_ID),
  ];
  const groupLabel = (id: string) => withFallbackLast.find((group) => group.id === id)?.label ?? id;

  return {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    groups: withFallbackLast
      .map((group) => ({
        ...group,
        chapters: documented.filter((c) => c.groupId === group.id),
      }))
      .filter((group) => group.chapters.length > 0),
    planned: planned.map((chapter) => ({
      chapter,
      groupLabel: groupLabel(chapter.groupId),
    })),
    stats: {
      chapters: documented.length,
      textMissing: documented.filter(isTextMissing).length,
      imageMissing: documented.filter((chapter) => missingImagesOf(chapter).length > 0).length,
      staleText: documented.filter((chapter) => staleTermsOf(chapter).length > 0).length,
      planned: planned.length,
    },
  };
}

export function inlineImageDest(locale: string, textsRoot: string, absSource: string): string {
  const relative = absSource.startsWith(`${textsRoot}/`)
    ? absSource.slice(textsRoot.length + 1)
    : `${basename(dirname(absSource))}/${basename(absSource)}`;
  return `shots/inline/${locale}/${relative.replace(/[^\w.-]+/g, "__").replace(/\.[^.]+$/, "")}.webp`;
}
