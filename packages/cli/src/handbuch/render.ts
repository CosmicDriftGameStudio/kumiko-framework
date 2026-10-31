import { existsSync } from "node:fs";
import { escapeHtmlAttr, raw } from "@cosmicdrift/kumiko-renderer/headless";
import { Marked } from "marked";
import { type BuildInfo, buildInfoLines } from "./buildinfo";
import { chromeFor } from "./chrome";
import { splitStepSections } from "./flows";
import {
  type Chapter,
  chapterTitle,
  hasMatrix,
  inlineImageDest,
  isLocalImageRef,
  isTextMissing,
  type LocaleText,
  type MatrixShots,
  type Model,
  missingImagesOf,
  resolveImagePath,
  staleTermsOf,
  VIEWPORT_WIDTH,
  VIEWPORTS,
  type Viewport,
} from "./model";
import { PAGE_SCRIPT, PAGE_STYLES } from "./page-assets";

export type ImageJob = { src: string; width: number; quality: number };

const WEBP_QUALITY = 80;
const LARGE_MAX_WIDTH = 2400;

function registerImage(images: ImagePlan, dest: string, src: string, width: number): string {
  images.jobs.set(dest, { src, width, quality: WEBP_QUALITY });
  if (!images.withLarge) return dest;
  const large = dest.replace(/\.webp$/, ".large.webp");
  images.jobs.set(large, {
    src,
    width: LARGE_MAX_WIDTH,
    quality: WEBP_QUALITY,
  });
  return large;
}

export type ImagePlan = { jobs: Map<string, ImageJob>; withLarge: boolean };

export function createImagePlan(withLarge: boolean): ImagePlan {
  return { jobs: new Map(), withLarge };
}

function missingImageBox(href: string, locale: string): string {
  return `<p class="gap-box gap-image"><span class="tag warn">${escapeHtmlAttr(chromeFor(locale).imageMissing)}</span> <code>${escapeHtmlAttr(href)}</code></p>`;
}

export function renderMarkdown(
  bodyMd: string,
  context: {
    locale: string;
    textsRoot: string;
    images: ImagePlan;
    chapterIds: ReadonlySet<string>;
  },
): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      image({ href, text }) {
        const alt = escapeHtmlAttr(text ?? "");
        if (!isLocalImageRef(href))
          return `<img src="${escapeHtmlAttr(href)}" alt="${alt}" loading="lazy">`;
        const source = resolveImagePath(context.textsRoot, href);
        if (!existsSync(source)) return missingImageBox(href, context.locale);
        const dest = inlineImageDest(context.locale, context.textsRoot, source);
        const large = registerImage(context.images, dest, source, 1600);
        return `<figure class="shot"><a href="${escapeHtmlAttr(large)}" data-large="${escapeHtmlAttr(large)}" target="_blank" rel="noopener"><img src="${escapeHtmlAttr(dest)}" alt="${alt}" loading="lazy"></a>${text ? `<figcaption>${alt}</figcaption>` : ""}</figure>`;
      },
      paragraph({ tokens }) {
        const innerHtml = this.parser.parseInline(tokens);
        return tokens.length === 1 && tokens[0]?.type === "image"
          ? `${innerHtml}\n`
          : `<p>${innerHtml}</p>\n`;
      },
      heading({ tokens, depth }) {
        const level = Math.min(depth + 1, 6);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      link({ href, tokens }) {
        const innerHtml = this.parser.parseInline(tokens);
        const target = href.replace(/\.md$/, "");
        if (href.endsWith(".md") && context.chapterIds.has(target))
          return `<a href="#${escapeHtmlAttr(target)}">${innerHtml}</a>`;
        return `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer">${innerHtml}</a>`;
      },
    },
  });
  return marked.parse(bodyMd, { async: false });
}

function pickShots(
  shotsByLocale: Map<string, MatrixShots>,
  locale: string,
  defaultLocale: string,
): { shots: MatrixShots; shotsLocale: string } | undefined {
  for (const candidate of [locale, defaultLocale, ...shotsByLocale.keys()]) {
    const shots = shotsByLocale.get(candidate);
    if (shots) return { shots, shotsLocale: candidate };
  }
  return undefined;
}

function framesHtml(
  destBase: string,
  altBase: string,
  shotsByLocale: Map<string, MatrixShots>,
  model: Model,
  images: ImagePlan,
): string {
  return model.locales
    .map((locale) => {
      const picked = pickShots(shotsByLocale, locale, model.defaultLocale);
      if (!picked) return "";
      const notice =
        picked.shotsLocale === locale
          ? ""
          : `<p class="notice">${escapeHtmlAttr(chromeFor(model.defaultLocale).shotsFallbackNotice(picked.shotsLocale.toUpperCase()))}</p>`;
      const frames = VIEWPORTS.flatMap((viewport) => {
        const source = picked.shots[viewport];
        if (!source) return [];
        const dest = `shots/${destBase}/${picked.shotsLocale}/${viewport}.webp`;
        const large = registerImage(images, dest, source, VIEWPORT_WIDTH[viewport]);
        const labelHtml = escapeHtmlAttr(chromeFor(model.defaultLocale).viewports[viewport]);
        return [
          `<figure class="frame" data-vp="${viewport}"><figcaption>${labelHtml}</figcaption><div class="dev ${viewport}"><a href="${escapeHtmlAttr(large)}" data-large="${escapeHtmlAttr(large)}" target="_blank" rel="noopener"><img src="${escapeHtmlAttr(dest)}" alt="${escapeHtmlAttr(altBase)} (${labelHtml})" loading="lazy"></a></div></figure>`,
        ];
      });
      return `<div class="stage-loc" data-loc="${escapeHtmlAttr(locale)}">${notice}<div class="frames">${raw(frames.join(""))}</div></div>`;
    })
    .join("\n");
}

function availableViewports(chapter: Chapter): Viewport[] {
  const all = [chapter.matrix, ...(chapter.steps ?? []).map((step) => step.shots)];
  return VIEWPORTS.filter((viewport) =>
    all.some((byLocale) => [...byLocale.values()].some((shots) => shots[viewport])),
  );
}

function stepsHtml(chapter: Chapter, model: Model, images: ImagePlan): string {
  const steps = chapter.steps ?? [];
  const slugs = new Set(steps.map((step) => step.slug));
  const chapterIds = new Set(model.groups.flatMap((g) => g.chapters.map((c) => c.id)));
  return steps
    .map((step) => {
      const texts = model.locales
        .map((locale) => {
          const own = chapter.texts.get(locale);
          const text = own ?? chapter.texts.get(model.defaultLocale);
          const section = text
            ? splitStepSections(text.bodyMd, slugs).sections.get(step.slug)
            : undefined;
          const body =
            text && section
              ? renderMarkdown(section, {
                  locale: own ? locale : model.defaultLocale,
                  textsRoot: text.dir,
                  images,
                  chapterIds,
                })
              : "";
          return `<div data-loc="${escapeHtmlAttr(locale)}">${body ? `<div class="prose step-text">${raw(body)}</div>` : ""}</div>`;
        })
        .join("");
      return `<article class="step"><h3>${escapeHtmlAttr(step.label)}</h3><div class="stage-col">${framesHtml(`${chapter.id}/${step.id}`, `${step.label}`, step.shots, model, images)}</div>${raw(texts)}</article>`;
    })
    .join("\n");
}

function localeTextHtml(chapter: Chapter, locale: string, model: Model, images: ImagePlan): string {
  const c = chromeFor(model.defaultLocale);
  const own = chapter.texts.get(locale);
  const text: LocaleText | undefined = own ?? chapter.texts.get(model.defaultLocale);
  if (!text) {
    return `<div class="gap-box"><span class="tag warn">${raw(c.textMissing)}</span> ${raw(c.textMissingBody)}</div>`;
  }
  const textLocale = own ? locale : model.defaultLocale;
  const notice = own
    ? ""
    : `<p class="notice">${escapeHtmlAttr(c.textFallbackNotice(model.defaultLocale.toUpperCase()))}</p>`;
  const badges = text.prozesse
    .map((p) => `<span class="badge">${escapeHtmlAttr(p)}</span>`)
    .join("");
  const chapterIds = new Set(model.groups.flatMap((g) => g.chapters.map((c) => c.id)));
  const bodyMd = chapter.steps
    ? splitStepSections(text.bodyMd, new Set(chapter.steps.map((step) => step.slug))).intro
    : text.bodyMd;
  const body = renderMarkdown(bodyMd, {
    locale: textLocale,
    textsRoot: text.dir,
    images,
    chapterIds,
  });
  const stale =
    text.staleTerms.length > 0
      ? `<div class="gap-box"><span class="tag warn">${raw(c.textStale)}</span> ${raw(c.staleBody)} ${text.staleTerms.map((term) => `<code>${escapeHtmlAttr(term)}</code>`).join(", ")}</div>`
      : "";
  return `${notice}${stale}${badges ? `<p class="badges">${badges}</p>` : ""}<div class="prose">${raw(body)}</div>`;
}

function chapterHtml(chapter: Chapter, model: Model, images: ImagePlan): string {
  const c = chromeFor(model.defaultLocale);
  const matrix = hasMatrix(chapter);
  const missing = missingImagesOf(chapter);
  const flags = [
    isTextMissing(chapter) ? `<span class="tag warn">${raw(c.textMissing)}</span>` : "",
    missing.length > 0
      ? `<span class="tag warn">${raw(c.imageMissing)} (${missing.length})</span>`
      : "",
    staleTermsOf(chapter).length > 0 ? `<span class="tag warn">${raw(c.textStale)}</span>` : "",
  ].join("");
  const head = model.locales
    .map(
      (locale) =>
        `<div data-loc="${escapeHtmlAttr(locale)}"><h2>${escapeHtmlAttr(chapterTitle(chapter, locale, model.defaultLocale))}</h2></div>`,
    )
    .join("");
  const text = model.locales
    .map(
      (locale) =>
        `<div data-loc="${escapeHtmlAttr(locale)}">${localeTextHtml(chapter, locale, model, images)}</div>`,
    )
    .join("\n");
  return `<section class="chapter${matrix && !chapter.steps ? " has-matrix" : ""}${isTextMissing(chapter) ? " no-text" : ""}" id="${escapeHtmlAttr(chapter.id)}" data-nav="${escapeHtmlAttr(chapter.id)}"${raw(matrix ? ` data-matrix="1" data-vps="${availableViewports(chapter).join(" ")}"` : "")}>
<header class="chapter-head">${head}<p class="meta"><code>${escapeHtmlAttr(chapter.id)}</code>${raw(flags)}</p></header>
${matrix && !chapter.steps ? `<div class="stage-col">${framesHtml(chapter.id, chapter.id, chapter.matrix, model, images)}</div>` : ""}
<div class="text-col">${text}</div>
${chapter.steps ? `<div class="steps">${stepsHtml(chapter, model, images)}</div>` : ""}
</section>`;
}

function overviewHtml(model: Model): string {
  const { stats } = model;
  const c = chromeFor(model.defaultLocale);
  const list = (title: string, chapters: Chapter[], detail?: (c: Chapter) => string) =>
    chapters.length === 0
      ? ""
      : `<h3>${raw(title)}</h3><ul class="gap-list">${chapters
          .map(
            (c) =>
              `<li><a href="#${escapeHtmlAttr(c.id)}">${escapeHtmlAttr(chapterTitle(c, model.defaultLocale, model.defaultLocale))}</a>${detail ? ` <code>${escapeHtmlAttr(detail(c))}</code>` : ""}</li>`,
          )
          .join("")}</ul>`;
  const documented = model.groups.flatMap((group) => group.chapters);
  return `<section class="chapter overview" id="uebersicht" data-nav="uebersicht">
<header class="chapter-head"><h2>${raw(c.overview)}</h2></header>
<div class="text-col"><div class="prose">
<div class="stat-row">
<div class="stat"><b>${stats.chapters}</b><span>${raw(c.chapters)}</span></div>
<div class="stat${stats.textMissing ? " warn" : ""}"><b>${stats.textMissing}</b><span>${raw(c.textMissing)}</span></div>
<div class="stat${stats.imageMissing ? " warn" : ""}"><b>${stats.imageMissing}</b><span>${raw(c.imageMissing)}</span></div>
<div class="stat${stats.staleText ? " warn" : ""}"><b>${stats.staleText}</b><span>${raw(c.textStale)}</span></div>
<div class="stat"><b>${stats.planned}</b><span>${raw(c.planned)}</span></div>
</div>
${list(c.textMissing, documented.filter(isTextMissing))}
${list(
  c.textStale,
  documented.filter((c) => staleTermsOf(c).length > 0),
  (c) => staleTermsOf(c).join(", "),
)}
${list(
  c.imageMissing,
  documented.filter((c) => missingImagesOf(c).length > 0),
  (c) => missingImagesOf(c).join(", "),
)}
</div></div></section>`;
}

function plannedHtml(model: Model): string {
  const c = chromeFor(model.defaultLocale);
  const [colScreen, colId, colGroup] = c.plannedColumns;
  const rows = model.planned
    .map(
      ({ chapter, groupLabel }) =>
        `<tr><td>${escapeHtmlAttr(chapter.screenTitle ?? chapter.id)}</td><td><code>${escapeHtmlAttr(chapter.id)}</code></td><td>${escapeHtmlAttr(groupLabel)}</td></tr>`,
    )
    .join("");
  const table =
    model.planned.length === 0
      ? `<p>${raw(c.plannedNone)}</p>`
      : `<table><thead><tr><th>${raw(colScreen)}</th><th>${raw(colId)}</th><th>${raw(colGroup)}</th></tr></thead><tbody>${rows}</tbody></table>`;
  return `<section class="chapter" id="geplante-masken" data-nav="geplante-masken">
<header class="chapter-head"><h2>${raw(c.planned)}</h2></header>
<div class="text-col"><div class="prose"><p>${raw(c.plannedIntro)}</p>${table}</div></div></section>`;
}

function navHtml(model: Model): { nav: string; select: string } {
  const c = chromeFor(model.defaultLocale);
  const link = (id: string, label: string, tags = "") =>
    `<a href="#${escapeHtmlAttr(id)}" data-nav-link="${escapeHtmlAttr(id)}"><span>${escapeHtmlAttr(label)}</span>${raw(tags)}</a>`;
  const option = (id: string, label: string) =>
    `<option value="${escapeHtmlAttr(id)}">${escapeHtmlAttr(label)}</option>`;
  const navParts = [link("uebersicht", c.overview)];
  const selectParts = [option("uebersicht", c.overview)];
  for (const group of model.groups) {
    navParts.push(`<h3>${escapeHtmlAttr(group.label)}</h3>`);
    selectParts.push(`<optgroup label="${escapeHtmlAttr(group.label)}">`);
    for (const chapter of group.chapters) {
      const title = chapterTitle(chapter, model.defaultLocale, model.defaultLocale);
      const tags =
        (isTextMissing(chapter) ? `<span class="tag warn">${raw(c.textMissing)}</span>` : "") +
        (missingImagesOf(chapter).length > 0
          ? `<span class="tag warn">${raw(c.imageMissing)}</span>`
          : "") +
        (staleTermsOf(chapter).length > 0
          ? `<span class="tag warn">${raw(c.textStale)}</span>`
          : "");
      navParts.push(link(chapter.id, title, tags));
      selectParts.push(option(chapter.id, title));
    }
    selectParts.push("</optgroup>");
  }
  navParts.push(`<h3>${raw(c.appendix)}</h3>`, link("geplante-masken", c.planned));
  selectParts.push(option("geplante-masken", c.planned));
  return { nav: navParts.join("\n"), select: selectParts.join("\n") };
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPage(
  title: string,
  model: Model,
  images: ImagePlan,
  info: BuildInfo,
): string {
  const chapters = model.groups.flatMap((group) => group.chapters);
  const sections = chapters.map((chapter) => chapterHtml(chapter, model, images)).join("\n");
  const { nav, select } = navHtml(model);
  const { stats } = model;
  const c = chromeFor(model.defaultLocale);
  const localeRules = model.locales
    .map(
      (locale) =>
        `html[data-locale="${locale}"] [data-loc]:not([data-loc="${locale}"]){display:none}`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="${escapeHtmlAttr(model.defaultLocale)}" data-locale="${escapeHtmlAttr(model.defaultLocale)}" data-vp="desktop">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlAttr(title)}</title>
<style>
${PAGE_STYLES}
${raw(localeRules)}
</style>
</head>
<body>
<div class="app">
<aside>
<div class="brand"><h1>${escapeHtmlAttr(title)}</h1>
<p class="build-info">${raw(buildInfoLines(info, c.builtAt).map(escapeHtmlAttr).join(" · "))}</p>
<div class="stats"><span><b>${stats.chapters}</b> ${raw(c.chapters)}</span><span><b>${stats.textMissing}</b> ${raw(c.textMissing)}</span><span><b>${stats.imageMissing}</b> ${raw(c.imageMissing)}</span><span><b>${stats.staleText}</b> ${raw(c.staleShort)}</span><span><b>${stats.planned}</b> ${raw(c.plannedShort)}</span></div></div>
<div class="mobile-pick"><label for="pick">${raw(c.chapters)}</label><select id="pick">${raw(select)}</select></div>
<nav id="nav" aria-label="${raw(c.chapters)}">${raw(nav)}</nav>
</aside>
<main>
<div class="bar">
<div class="title"><b id="bar-title"></b></div>
<div class="seg" id="seg-locale" role="group" aria-label="${raw(c.language)}"></div>
<div class="seg" id="seg-vp" role="group" aria-label="${raw(c.size)}"></div>
<span class="hint">${raw(c.hint)}</span>
</div>
<div class="content">
${overviewHtml(model)}
${sections}
${plannedHtml(model)}
</div>
</main>
</div>
<dialog id="lightbox" aria-label="${raw(c.lightbox)}"><button type="button" class="lb-close" id="lb-close">${raw(c.close)}</button><div class="lb-scroll" id="lb-scroll"><img id="lb-img" alt=""></div></dialog>
<script>
const LOCALES = ${raw(jsonForScript(model.locales))};
const DEFAULT_LOCALE = ${raw(jsonForScript(model.defaultLocale))};
const VIEWPORT_LABELS = ${raw(jsonForScript(c.viewports))};
${PAGE_SCRIPT}
</script>
</body>
</html>
`;
}
