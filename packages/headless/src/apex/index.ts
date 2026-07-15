// Apex marketing-surface renderer — turns a typed page description into a
// complete static HTML string. The shared structure (header/hero/feature-grid/
// pricing-grid/info-grid/final-cta/footer) lives here; apps pass only their data,
// brand tokens (brand.tokensCss) and content. Server-side, zero React, one
// cacheable HTTP response. See APEX_STRUCTURAL_CSS for the CSS contract.

import { escapeHtml } from "../format";
import { APEX_STRUCTURAL_CSS } from "./css";
import { APEX_LIGHTBOX_HTML, APEX_LIGHTBOX_SCRIPT } from "./lightbox";

export { APEX_NAV_MENU_CSS, APEX_STRUCTURAL_CSS } from "./css";
export {
  APEX_LIGHTBOX_HTML,
  APEX_LIGHTBOX_SCRIPT,
  APEX_LIGHTBOX_SCRIPT_CSP_HASH,
} from "./lightbox";

export type ApexTheme = "light" | "dark";

/** Brand is raw CSS the app owns: the :root token block and optional @font-face.
 *  Token names referenced by the structural CSS: --bg --bg-card --bg-muted
 *  --border --fg --fg-muted --fg-subtle --primary --primary-hover --primary-fg
 *  --status-ok --shadow. Optional: --accent --accent-fg --font-mono --font-body,
 *  and (dark theme) --on-dark --on-dark-muted --on-dark-border. */
export type ApexBrand = {
  readonly tokensCss: string;
  readonly fontFaceCss?: string;
};

export type ApexCtaVariant = "primary" | "secondary" | "link";
export type ApexCta = {
  readonly label: string;
  /** App-authored only, no user input — escapeHtml encodes entities but does
   *  NOT sanitize the URL scheme (a `javascript:`/`data:` URI survives it
   *  unchanged). Trust boundary is the deploy-time apex config, not runtime. */
  readonly href: string;
  /** "link" renders a plain anchor (no .btn). Default "primary". */
  readonly variant?: ApexCtaVariant;
};

// `kind` is optional here (footer links / ApexNavMenu.footer don't need it) —
// it exists so ApexNavEntry (ApexLink | ApexNavMenu) is a real discriminated
// union: TS narrows on `entry.kind === "menu"` without a structural
// `"items" in entry` check or an `as` cast.
export type ApexLink = { readonly kind?: "link"; readonly label: string; readonly href: string };

/** One entry inside a dropdown nav menu: icon + title + optional description. */
export type ApexNavMenuItem = {
  /** Inner SVG markup (paths), wrapped by the standard 24px icon <svg>.
   *  ponytail: rendered verbatim, no sanitizer — trusted because it's
   *  app-authored at deploy time, same trust boundary as ApexCta.href. If an
   *  app ever sources this from tenant/user content, sanitize at that
   *  construction boundary before it reaches here. */
  readonly icon?: string;
  readonly title: string;
  readonly desc?: string;
  readonly href: string;
};

/** A header nav entry that opens a dropdown (icon/title/desc rows) instead of
 *  navigating. CSS-only: reveals on hover + keyboard focus. */
export type ApexNavMenu = {
  readonly kind: "menu";
  readonly label: string;
  readonly items: readonly ApexNavMenuItem[];
  /** Optional link under a divider at the foot of the panel (e.g. "See all →"). */
  readonly footer?: ApexLink;
};

/** A header nav entry: a plain link, or a dropdown menu. */
export type ApexNavEntry = ApexLink | ApexNavMenu;
export type ApexImage = {
  readonly src: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
};

export type ApexHeader = {
  readonly brand: { readonly href: string; readonly label: string; readonly logoSrc?: string };
  /** Plain links and/or dropdown menus, in order. */
  readonly navLinks?: readonly ApexNavEntry[];
  readonly actions?: readonly ApexCta[];
};

export type ApexFooterColumn = { readonly heading: string; readonly links: readonly ApexLink[] };
export type ApexFooter = {
  readonly brand: { readonly label: string; readonly logoSrc?: string };
  readonly tagline?: string;
  readonly columns?: readonly ApexFooterColumn[];
  /** Plain text — use unicode (© ·), not HTML entities; rendered escaped. */
  readonly bottomLeft?: string;
  readonly bottomRight?: string;
};

export type ApexHeroSection = {
  readonly kind: "hero";
  readonly logo?: ApexImage;
  readonly title: string;
  readonly tagline: string;
  readonly ctas?: readonly ApexCta[];
  /** App-authored trusted HTML (e.g. <strong>…<br/>); rendered verbatim. */
  readonly metaHtml?: string;
  readonly screenshot?: ApexImage;
};

export type ApexFeature = {
  /** Inner SVG markup (paths), wrapped by the standard 24px icon <svg>.
   *  ponytail: rendered verbatim, no sanitizer — trusted because it's
   *  app-authored at deploy time, same trust boundary as ApexCta.href. If an
   *  app ever sources this from tenant/user content, sanitize at that
   *  construction boundary before it reaches here. */
  readonly icon?: string;
  readonly title: string;
  readonly desc: string;
};
export type ApexFeatureGridSection = {
  readonly kind: "feature-grid";
  readonly id?: string;
  readonly eyebrow?: string;
  readonly heading: string;
  readonly sub?: string;
  /** Sit on the muted band (.features). Default true. */
  readonly muted?: boolean;
  readonly items: readonly ApexFeature[];
};

export type ApexPricingTier = {
  readonly name: string;
  readonly tagline?: string;
  /** App-formatted ("4,99 €", "0 €", "auf Anfrage"). */
  readonly amount: string;
  /** Localized suffix after the amount ("/Monat", "/month"). */
  readonly priceSuffix?: string;
  readonly featured?: boolean;
  readonly badge?: string;
  readonly capLine?: string;
  readonly benefits: readonly string[];
  readonly cta: ApexCta;
};
export type ApexPricingGridSection = {
  readonly kind: "pricing-grid";
  readonly id?: string;
  readonly eyebrow?: string;
  readonly heading: string;
  readonly sub?: string;
  readonly tiers: readonly ApexPricingTier[];
};

export type ApexInfoItem = { readonly title: string; readonly desc: string };
export type ApexInfoGridSection = {
  readonly kind: "info-grid";
  readonly id?: string;
  readonly eyebrow?: string;
  readonly heading?: string;
  readonly sub?: string;
  readonly muted?: boolean;
  readonly items: readonly ApexInfoItem[];
};

export type ApexFinalCtaSection = {
  readonly kind: "final-cta";
  readonly image?: ApexImage;
  readonly heading: string;
  readonly sub?: string;
  readonly cta: ApexCta;
};

/** Escape hatch for an app-specific section: raw, app-authored HTML. */
export type ApexHtmlSection = { readonly kind: "html"; readonly html: string };

export type ApexSection =
  | ApexHeroSection
  | ApexFeatureGridSection
  | ApexPricingGridSection
  | ApexInfoGridSection
  | ApexFinalCtaSection
  | ApexHtmlSection;

export type ApexHead = {
  readonly lang: string;
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl?: string;
  readonly faviconHref?: string;
  readonly ogImage?: string;
  /** hreflang alternates for multilingual SEO (e.g. the other language's URL). */
  readonly alternates?: readonly { readonly hreflang: string; readonly href: string }[];
  /** Robots meta content (e.g. "index, follow", "noindex, nofollow"). Omit = no tag. */
  readonly robots?: string;
  /** og:site_name — brand name for social shares. */
  readonly siteName?: string;
  /** og:locale — e.g. "de_DE", "en_US". */
  readonly locale?: string;
  /** twitter:site — @handle for X/Twitter card. */
  readonly twitterSite?: string;
  /** URLs for <link rel="preconnect"> hints (Core Web Vitals). */
  readonly preconnects?: readonly string[];
  /** Arbitrary JSON-LD structured data (Schema.org). Rendered as-is into <script type="application/ld+json">. */
  readonly schemaJson?: Record<string, unknown>;
};

export type ApexPage = {
  readonly theme?: ApexTheme;
  readonly brand: ApexBrand;
  readonly head: ApexHead;
  readonly header: ApexHeader;
  readonly sections: readonly ApexSection[];
  readonly footer: ApexFooter;
};

// JSON in <script>-Kontext: `<` als < serialisieren, damit weder
// `</script>` noch `<!--` aus dem Block ausbrechen kann (JSON bleibt valide).
function scriptSafeJsonHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function dim(img: ApexImage): string {
  return `${img.width !== undefined ? ` width="${img.width}"` : ""}${img.height !== undefined ? ` height="${img.height}"` : ""}`;
}

function svgIcon(innerHtml: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${innerHtml}</svg>`;
}

function renderCta(cta: ApexCta): string {
  const variant = cta.variant ?? "primary";
  const cls = variant === "link" ? "" : ` class="btn btn-${variant}"`;
  return `<a${cls} href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>`;
}

function renderSectionHead(s: {
  readonly eyebrow?: string;
  readonly heading?: string;
  readonly sub?: string;
}): string {
  if (s.eyebrow === undefined && s.heading === undefined && s.sub === undefined) return "";
  const eyebrow =
    s.eyebrow !== undefined ? `<span class="eyebrow">${escapeHtml(s.eyebrow)}</span>` : "";
  const heading = s.heading !== undefined ? `<h2>${escapeHtml(s.heading)}</h2>` : "";
  const sub = s.sub !== undefined ? `<p>${escapeHtml(s.sub)}</p>` : "";
  return `<div class="section-head">${eyebrow}${heading}${sub}</div>`;
}

function bandAttrs(muted: boolean | undefined, id: string | undefined): string {
  const cls = muted === false ? "" : ` class="features"`;
  const idAttr = id !== undefined ? ` id="${escapeHtml(id)}"` : "";
  return cls + idAttr;
}

function renderHero(s: ApexHeroSection): string {
  const logo =
    s.logo !== undefined
      ? `<img class="hero-pony" src="${escapeHtml(s.logo.src)}" alt="${escapeHtml(s.logo.alt)}"${dim(s.logo)} />`
      : "";
  const ctas = (s.ctas ?? []).map(renderCta).join("\n            ");
  const meta = s.metaHtml !== undefined ? `<p class="hero-meta">${s.metaHtml}</p>` : "";
  const visual =
    s.screenshot !== undefined
      ? `<div class="hero-visual"><div class="shot-frame"><div class="shot-bar"><span></span><span></span><span></span></div><img src="${escapeHtml(s.screenshot.src)}" alt="${escapeHtml(s.screenshot.alt)}"${dim(s.screenshot)} loading="eager" /></div></div>`
      : "";
  return `<section class="hero">
      <div class="container hero-grid">
        <div class="hero-copy">
          ${logo}<h1>${escapeHtml(s.title)}</h1>
          <p class="tagline">${escapeHtml(s.tagline)}</p>
          ${ctas !== "" ? `<div class="hero-cta">${ctas}</div>` : ""}
          ${meta}
        </div>
        ${visual}
      </div>
    </section>`;
}

function renderFeatureGrid(s: ApexFeatureGridSection): string {
  const cards = s.items
    .map(
      (f) => `<article class="feature">
            ${f.icon !== undefined ? `<div class="feature-icon">${svgIcon(f.icon)}</div>` : ""}<h3>${escapeHtml(f.title)}</h3>
            <p>${escapeHtml(f.desc)}</p>
          </article>`,
    )
    .join("\n          ");
  return `<section${bandAttrs(s.muted, s.id)}>
      <div class="container">
        ${renderSectionHead(s)}
        <div class="feature-grid">
          ${cards}
        </div>
      </div>
    </section>`;
}

function renderPricingCard(t: ApexPricingTier): string {
  const featured = t.featured === true;
  const badge =
    t.badge !== undefined ? `<span class="price-badge">${escapeHtml(t.badge)}</span>` : "";
  const cap =
    t.capLine !== undefined ? [`<li class="price-cap">${escapeHtml(t.capLine)}</li>`] : [];
  const benefits = t.benefits.map((b) => `<li>${escapeHtml(b)}</li>`);
  const items = [...cap, ...benefits].join("\n            ");
  const per = t.priceSuffix !== undefined ? `<span>${escapeHtml(t.priceSuffix)}</span>` : "";
  const tagline =
    t.tagline !== undefined ? `<p class="price-tagline">${escapeHtml(t.tagline)}</p>` : "";
  // Delegates to renderCta so a `variant: "link"` tier CTA gets the same
  // class-free anchor as everywhere else instead of re-deriving the class
  // string here (a prior inline duplicate had no "link" case, always
  // emitting `.btn-link`, which the structural CSS never defines).
  const cta =
    t.cta.variant === undefined
      ? renderCta({ ...t.cta, variant: featured ? "primary" : "secondary" })
      : renderCta(t.cta);
  return `<article class="price-card${featured ? " price-card--featured" : ""}">
          ${badge}<h3>${escapeHtml(t.name)}</h3>
          ${tagline}<div class="price-amount">${escapeHtml(t.amount)}${per}</div>
          <ul class="price-list">
            ${items}
          </ul>
          ${cta}
        </article>`;
}

function renderPricingGrid(s: ApexPricingGridSection): string {
  const cards = s.tiers.map(renderPricingCard).join("\n          ");
  const idAttr = s.id !== undefined ? ` id="${escapeHtml(s.id)}"` : "";
  return `<section${idAttr}>
      <div class="container">
        ${renderSectionHead(s)}
        <div class="price-grid">
          ${cards}
        </div>
      </div>
    </section>`;
}

function renderInfoGrid(s: ApexInfoGridSection): string {
  const items = s.items
    .map(
      (i) => `<div class="trust-item">
            <h3>${escapeHtml(i.title)}</h3>
            <p>${escapeHtml(i.desc)}</p>
          </div>`,
    )
    .join("\n          ");
  return `<section${bandAttrs(s.muted, s.id)}>
      <div class="container">
        ${renderSectionHead(s)}
        <div class="trust-grid">
          ${items}
        </div>
      </div>
    </section>`;
}

function renderFinalCta(s: ApexFinalCtaSection): string {
  const img =
    s.image !== undefined
      ? `<img class="final-cta-pony" src="${escapeHtml(s.image.src)}" alt="${escapeHtml(s.image.alt)}"${dim(s.image)} />`
      : "";
  const sub = s.sub !== undefined ? `<p>${escapeHtml(s.sub)}</p>` : "";
  return `<section class="final-cta">
      <div class="container">
        ${img}<h2>${escapeHtml(s.heading)}</h2>
        ${sub}${renderCta(s.cta)}
      </div>
    </section>`;
}

function renderSection(s: ApexSection): string {
  switch (s.kind) {
    case "hero":
      return renderHero(s);
    case "feature-grid":
      return renderFeatureGrid(s);
    case "pricing-grid":
      return renderPricingGrid(s);
    case "info-grid":
      return renderInfoGrid(s);
    case "final-cta":
      return renderFinalCta(s);
    case "html":
      return s.html;
  }
}

function renderNavMenu(m: ApexNavMenu): string {
  const items = m.items
    .map(
      (it) =>
        `<a class="nav-menu__item" href="${escapeHtml(it.href)}">${
          it.icon !== undefined ? `<span class="nav-menu__icon">${svgIcon(it.icon)}</span>` : ""
        }<span class="nav-menu__text"><span class="nav-menu__title">${escapeHtml(it.title)}</span>${
          it.desc !== undefined ? `<span class="nav-menu__desc">${escapeHtml(it.desc)}</span>` : ""
        }</span></a>`,
    )
    .join("");
  const footer =
    m.footer !== undefined
      ? `<div class="nav-menu__sep"></div><a class="nav-menu__more" href="${escapeHtml(m.footer.href)}">${escapeHtml(m.footer.label)}</a>`
      : "";
  return `<div class="nav-menu"><button type="button" class="nav-menu__trigger" aria-haspopup="true">${escapeHtml(m.label)}<span class="nav-menu__chev">${svgIcon('<path d="m6 9 6 6 6-6"/>')}</span></button><div class="nav-menu__panel">${items}${footer}</div></div>`;
}

function renderNavEntry(entry: ApexNavEntry): string {
  return entry.kind === "menu"
    ? renderNavMenu(entry)
    : `<a href="${escapeHtml(entry.href)}">${escapeHtml(entry.label)}</a>`;
}

/** Render just the apex header chrome (brand + nav + actions). Exported so a
 *  consumer that composes its own page shell (not a full apex page) can reuse
 *  the identical header — markup stays single-source. */
export function renderApexHeader(h: ApexHeader): string {
  const logo =
    h.brand.logoSrc !== undefined ? `<img src="${escapeHtml(h.brand.logoSrc)}" alt="" /> ` : "";
  const navLinks = (h.navLinks ?? []).map(renderNavEntry).join("\n      ");
  const actions = (h.actions ?? []).map(renderCta);
  return `<header>
    <div class="container nav">
      <div class="brand"><a href="${escapeHtml(h.brand.href)}">${logo}${escapeHtml(h.brand.label)}</a></div>
      ${navLinks !== "" ? `<nav class="nav-links">${navLinks}</nav>` : ""}
      ${actions.length > 0 ? `<div class="nav-actions">${actions.join("\n      ")}</div>` : ""}
    </div>
  </header>`;
}

function renderFooter(f: ApexFooter): string {
  const cols = f.columns ?? [];
  const logo =
    f.brand.logoSrc !== undefined ? `<img src="${escapeHtml(f.brand.logoSrc)}" alt="" /> ` : "";
  const colHtml = cols
    .map(
      (c) => `<div class="footer-col">
        <h4>${escapeHtml(c.heading)}</h4>
        ${c.links.map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`).join("\n        ")}
      </div>`,
    )
    .join("\n      ");
  const bottom =
    f.bottomLeft !== undefined || f.bottomRight !== undefined
      ? `<div class="footer-bottom">
      ${f.bottomLeft !== undefined ? `<span>${escapeHtml(f.bottomLeft)}</span>` : ""}
      ${f.bottomRight !== undefined ? `<span>${escapeHtml(f.bottomRight)}</span>` : ""}
    </div>`
      : "";
  return `<footer>
    <div class="container">
      <div class="footer-grid" style="--footer-cols:${Math.max(1, cols.length)}">
        <div>
          <div class="footer-brand">${logo}${escapeHtml(f.brand.label)}</div>
          ${f.tagline !== undefined ? `<p class="footer-tagline">${escapeHtml(f.tagline)}</p>` : ""}
        </div>
        ${colHtml}
      </div>
      ${bottom}
    </div>
  </footer>`;
}

// All <title>/meta/link/script tags for an ApexHead — the single source both
// renderApexPage and any other head (e.g. page-render's wrapInLayout) splice
// into their own <head>. Extracted verbatim from renderApexPage so existing
// output stays byte-identical (see render.test.ts regression coverage).
export function renderApexHeadTags(head: ApexHead): string {
  const ogUrl =
    head.canonicalUrl !== undefined
      ? `\n    <meta property="og:url" content="${escapeHtml(head.canonicalUrl)}" />`
      : "";
  const ogImage =
    head.ogImage !== undefined
      ? `\n    <meta property="og:image" content="${escapeHtml(head.ogImage)}" />`
      : "";
  const favicon =
    head.faviconHref !== undefined
      ? `\n    <link rel="icon" href="${escapeHtml(head.faviconHref)}" />`
      : "";
  const canonical =
    head.canonicalUrl !== undefined
      ? `\n    <link rel="canonical" href="${escapeHtml(head.canonicalUrl)}" />`
      : "";
  const alternates = (head.alternates ?? [])
    .map(
      (a) =>
        `\n    <link rel="alternate" hreflang="${escapeHtml(a.hreflang)}" href="${escapeHtml(a.href)}" />`,
    )
    .join("");
  const robots =
    head.robots !== undefined
      ? `\n    <meta name="robots" content="${escapeHtml(head.robots)}" />`
      : "";
  const siteName =
    head.siteName !== undefined
      ? `\n    <meta property="og:site_name" content="${escapeHtml(head.siteName)}" />`
      : "";
  const locale =
    head.locale !== undefined
      ? `\n    <meta property="og:locale" content="${escapeHtml(head.locale)}" />`
      : "";
  const twitterCard =
    head.ogImage !== undefined
      ? `\n    <meta name="twitter:card" content="summary_large_image" />`
      : "";
  const twitterSite =
    head.twitterSite !== undefined
      ? `\n    <meta name="twitter:site" content="${escapeHtml(head.twitterSite)}" />`
      : "";
  const preconnects = (head.preconnects ?? [])
    .map((url) => `\n    <link rel="preconnect" href="${escapeHtml(url)}" />`)
    .join("");
  const schema =
    head.schemaJson !== undefined
      ? `\n    <script type="application/ld+json">${scriptSafeJsonHtml(head.schemaJson)}</script>`
      : "";
  const metaDescription = head.description
    ? `\n    <meta name="description" content="${escapeHtml(head.description)}" />`
    : "";
  const ogDescription = head.description
    ? `\n    <meta property="og:description" content="${escapeHtml(head.description)}" />`
    : "";
  return `<title>${escapeHtml(head.title)}</title>${metaDescription}
    <meta property="og:title" content="${escapeHtml(head.title)}" />${ogDescription}
    <meta property="og:type" content="website" />${ogUrl}${ogImage}${siteName}${locale}${twitterCard}${twitterSite}${favicon}${canonical}${alternates}${robots}${preconnects}${schema}`;
}

export function renderApexPage(page: ApexPage): string {
  const { head, brand } = page;
  const theme = page.theme ?? "light";
  // Brand-CSS ist app-authored (Trust-Boundary siehe Datei-Header), kein Tenant-Input.
  const cssHtml = (brand.fontFaceCss ?? "") + brand.tokensCss + APEX_STRUCTURAL_CSS;
  const sections = page.sections.map(renderSection).join("\n\n    ");
  return `<!doctype html>
<html lang="${escapeHtml(head.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    ${renderApexHeadTags(head)}
    <style>${cssHtml}</style>
  </head>
  <body${theme === "dark" ? ` class="apex-dark"` : ""}>
    ${renderApexHeader(page.header)}

    ${sections}

    ${renderFooter(page.footer)}

    ${APEX_LIGHTBOX_HTML}
    ${APEX_LIGHTBOX_SCRIPT}
  </body>
</html>`;
}
