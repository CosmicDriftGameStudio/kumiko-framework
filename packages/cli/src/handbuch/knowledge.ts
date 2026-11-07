import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HandbuchConfig } from "./config";
import { type BuildModelOptions, buildModel, type Chapter, type Model } from "./model";

export type KnowledgePageKind = "process" | "screen";

export type KnowledgePage = {
  id: string;
  kind: KnowledgePageKind;
  title: string;
  questions: string[];
  screens: string[];
  start?: string;
  bodyMd: string;
};

export type KnowledgeFile = {
  defaultLocale: string;
  locales: Record<string, KnowledgePage[]>;
};

const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

export function stripMarkdownImages(bodyMd: string): string {
  return bodyMd
    .replace(MARKDOWN_IMAGE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function pageOf(chapter: Chapter, locale: string): KnowledgePage | undefined {
  const text = chapter.texts.get(locale);
  if (!text) return undefined;
  const kind: KnowledgePageKind = chapter.isProcess ? "process" : "screen";
  return {
    id: chapter.id,
    kind,
    title: text.title,
    questions: text.questions,
    screens: kind === "process" ? text.screens : [chapter.id],
    ...(kind === "process" && text.start !== undefined && { start: text.start }),
    bodyMd: stripMarkdownImages(text.bodyMd),
  };
}

function comparePages(a: KnowledgePage, b: KnowledgePage): number {
  return compareText(a.kind, b.kind) || compareText(a.id, b.id);
}

export function buildKnowledge(model: Model): KnowledgeFile {
  const chapters = model.groups.flatMap((group) => group.chapters);
  const locales: Record<string, KnowledgePage[]> = {};
  for (const locale of [...model.locales].sort(compareText)) {
    locales[locale] = chapters
      .flatMap((chapter) => pageOf(chapter, locale) ?? [])
      .sort(comparePages);
  }
  return { defaultLocale: model.defaultLocale, locales };
}

export async function writeKnowledge(
  config: HandbuchConfig,
  options: BuildModelOptions & { outFile: string },
): Promise<{ outFile: string; pageCounts: Record<string, number> }> {
  const { outFile, ...modelOptions } = options;
  const knowledge = buildKnowledge(await buildModel(config, modelOptions));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(knowledge, null, 2)}\n`);
  return {
    outFile,
    pageCounts: Object.fromEntries(
      Object.entries(knowledge.locales).map(([locale, pages]) => [locale, pages.length]),
    ),
  };
}
