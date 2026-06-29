// Structural CSS for the Apex marketing surface — shared by every app's static
// landing. Brand TOKEN VALUES (:root custom properties) and @font-face stay
// app-side (passed as brand.tokensCss / brand.fontFaceCss); this file owns only
// the structure: layout, grids, cards, buttons, header/footer, responsive.
//
// Two themes ship together; the <body class> selects one (see renderApexPage):
//   - light (default): chrome on light backgrounds — translucent blurred header.
//   - .apex-dark: header/hero/final-cta/footer sit on --primary with --on-dark
//     text + inverted buttons (the "dark sandwich"). Requires the app's tokens
//     to define --on-dark / --on-dark-muted / --on-dark-border.
//
// Token divergence is absorbed by CSS fallbacks, not parameters:
//   --font-mono unset        → .price-amount stays in body font (var(--font-mono, inherit))
//   --accent-hover unset     → eyebrow falls back to --primary
//   --hero-tagline-max unset → hero tagline runs full column (var(--hero-tagline-max, none))
//   icon tint                → color-mix derives a faint --primary wash, no hardcoded rgba

const BASE_LAYOUT = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font-body, "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
    background: var(--bg); color: var(--fg); line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh; display: flex; flex-direction: column;
  }
  main { flex: 1; }
  a { color: var(--primary); text-decoration: none; }
  a:hover { color: var(--primary-hover); }
  h1, h2, h3 { letter-spacing: -0.02em; }
  .container { max-width: 1120px; margin: 0 auto; padding: 0 1.5rem; width: 100%; }
  .container-narrow { max-width: 760px; margin: 0 auto; padding: 0 1.5rem; width: 100%; }
  .btn {
    display: inline-block; padding: 0.6rem 1.15rem; border-radius: 0.5rem;
    font-weight: 600; font-size: 0.9375rem; border: 1px solid transparent;
    cursor: pointer; transition: background 0.15s, border-color 0.15s, transform 0.05s;
  }
  .btn:active { transform: translateY(1px); }
  .btn-primary { background: var(--primary); color: var(--primary-fg); }
  .btn-primary:hover { background: var(--primary-hover); color: var(--primary-fg); }
  .btn-secondary { background: var(--bg-card); color: var(--fg); border-color: var(--border); }
  .btn-secondary:hover { border-color: var(--fg-muted); color: var(--fg); }

  section { padding: 5rem 0; }
  .section-head { text-align: center; max-width: 640px; margin: 0 auto 3rem; }
  .section-head h2 { font-size: clamp(1.6rem, 3.5vw, 2.25rem); margin: 0 0 0.75rem; }
  .section-head p { color: var(--fg-muted); margin: 0; font-size: 1.0625rem; }
  .eyebrow { display: inline-block; font-size: 0.8125rem; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--accent-hover, var(--primary)); margin-bottom: 0.75rem; }
`;

const HERO = `
  .hero { padding: 4.5rem 0 4rem; }
  .hero-grid { display: grid; grid-template-columns: 1.05fr 1fr; gap: 3.5rem; align-items: center; }
  .hero-pony { width: 88px; height: 88px; margin: 0 0 1.1rem; display: block; }
  .hero h1 { font-size: clamp(2.1rem, 4.5vw, 3.4rem); line-height: 1.08; margin: 0 0 1.1rem; font-weight: 700; }
  .hero .tagline { font-size: clamp(1.05rem, 1.6vw, 1.25rem); color: var(--fg-muted); margin: 0 0 1.75rem; max-width: var(--hero-tagline-max, none); }
  .hero-cta { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .hero-meta { margin-top: 1.5rem; font-size: 0.875rem; color: var(--fg-subtle); }
  .hero-meta strong { color: var(--fg-muted); font-weight: 600; }
  .shot-frame { border-radius: 0.75rem; border: 1px solid var(--border); background: var(--bg-card);
    box-shadow: var(--shadow); overflow: hidden; }
  .shot-bar { display: flex; gap: 0.4rem; padding: 0.6rem 0.85rem; border-bottom: 1px solid var(--border); background: var(--bg-muted); }
  .shot-bar span { width: 0.65rem; height: 0.65rem; border-radius: 50%; background: var(--border); }
  .shot-frame img { display: block; width: 100%; height: auto; }
`;

const FEATURES = `
  .features { background: var(--bg-muted); }
  .feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
  .feature { background: var(--bg-card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.75rem; }
  .feature-icon { width: 2.5rem; height: 2.5rem; border-radius: 0.6rem; display: flex; align-items: center;
    justify-content: center; background: color-mix(in srgb, var(--primary) 9%, transparent); color: var(--primary); margin-bottom: 1rem; }
  .feature-icon svg { width: 1.35rem; height: 1.35rem; }
  .feature h3 { font-size: 1.0625rem; margin: 0 0 0.4rem; }
  .feature p { color: var(--fg-muted); margin: 0; font-size: 0.9375rem; }
`;

const PRICING = `
  .price-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; align-items: stretch; }
  .price-card { position: relative; background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 0.75rem; padding: 1.75rem 1.5rem; display: flex; flex-direction: column; gap: 0.85rem; }
  .price-card--featured { border-color: var(--primary); box-shadow: var(--shadow); }
  .price-badge { position: absolute; top: -0.7rem; left: 50%; transform: translateX(-50%);
    background: var(--accent, var(--primary)); color: var(--accent-fg, var(--primary-fg)); font-size: 0.75rem; font-weight: 700;
    padding: 0.2rem 0.7rem; border-radius: 999px; white-space: nowrap; }
  .price-card h3 { margin: 0; font-size: 1.25rem; }
  .price-tagline { margin: 0; color: var(--fg-subtle); font-size: 0.875rem; }
  .price-amount { font-size: 2rem; font-weight: 700; font-family: var(--font-mono, inherit); }
  .price-amount span { font-size: 0.9375rem; font-weight: 500; color: var(--fg-subtle); font-family: inherit; }
  .price-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; flex: 1; }
  .price-list li { position: relative; padding-left: 1.5rem; font-size: 0.9rem; color: var(--fg-muted); }
  .price-list li::before { content: ""; position: absolute; left: 0; top: 0.45rem; width: 0.7rem; height: 0.4rem;
    border-left: 2px solid var(--status-ok); border-bottom: 2px solid var(--status-ok); transform: rotate(-45deg); }
  .price-list li.price-cap { font-weight: 600; color: var(--fg); }
  .price-card .btn { text-align: center; margin-top: 0.5rem; }
`;

const TRUST = `
  .trust-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; }
  .trust-item h3 { font-size: 1.0625rem; margin: 0 0 0.4rem; }
  .trust-item p { color: var(--fg-muted); margin: 0; font-size: 0.9375rem; }
`;

const FINAL_CTA = `
  .final-cta { text-align: center; }
  .final-cta-pony { width: 96px; height: auto; display: block; margin: 0 auto 1rem; }
  .final-cta h2 { font-size: clamp(1.6rem, 3.5vw, 2.25rem); margin: 0 0 0.75rem; }
  .final-cta p { color: var(--fg-muted); margin: 0 0 1.75rem; font-size: 1.0625rem; }
`;

// Light chrome (default). Header floats translucent over the page; footer is a
// muted band. Dark theme overrides both below.
const CHROME_LIGHT = `
  header { position: sticky; top: 0; z-index: 10;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: saturate(140%) blur(8px);
    border-bottom: 1px solid var(--border); }
  .nav { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.85rem 0; }
  .brand { display: flex; align-items: center; gap: 0.55rem; font-weight: 700; font-size: 1.125rem; color: var(--fg); }
  .brand a { color: var(--fg); display: inline-flex; align-items: center; gap: 0.55rem; }
  .brand a:hover { color: var(--fg); }
  .brand img { width: 1.7rem; height: 1.7rem; border-radius: 0.4rem; }
  .nav-links { display: flex; gap: 1.5rem; align-items: center; font-size: 0.9375rem; }
  .nav-links a { color: var(--fg-muted); }
  .nav-links a:hover { color: var(--fg); }
  .nav-actions { display: flex; gap: 0.75rem; align-items: center; font-size: 0.9375rem; }
  .nav-actions > a:not(.btn) { color: var(--fg-muted); }
  .nav-actions > a:not(.btn):hover { color: var(--fg); }
  @media (max-width: 640px) { .nav-links { display: none; } }

  footer { border-top: 1px solid var(--border); color: var(--fg-subtle); padding: 3.5rem 0 2.5rem; font-size: 0.9rem; }
  .footer-grid { display: grid; gap: 2rem; grid-template-columns: 1.6fr repeat(var(--footer-cols, 2), 1fr); }
  .footer-brand { display: flex; align-items: center; gap: 0.55rem; font-weight: 700; color: var(--fg); margin-bottom: 0.75rem; }
  .footer-brand img { width: 1.6rem; height: 1.6rem; border-radius: 0.4rem; }
  .footer-tagline { color: var(--fg-subtle); max-width: 34ch; margin: 0; }
  .footer-col h4 { font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-subtle); margin: 0 0 0.85rem; }
  .footer-col a { display: block; color: var(--fg-muted); margin-bottom: 0.5rem; }
  .footer-col a:hover { color: var(--fg); }
  .footer-bottom { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.75rem; }
`;

// Dark sandwich: header/hero/final-cta/footer ride on --primary. Buttons invert
// (a --primary button on --primary would vanish) → light button, --primary text.
const CHROME_DARK = `
  .apex-dark header { background: var(--primary); backdrop-filter: none; border-bottom: 1px solid var(--on-dark-border); }
  .apex-dark .brand, .apex-dark .brand a, .apex-dark .brand a:hover { color: var(--on-dark); }
  .apex-dark .nav-links a { color: var(--on-dark-muted); }
  .apex-dark .nav-links a:hover { color: var(--on-dark); }
  .apex-dark .nav-actions > a:not(.btn) { color: var(--on-dark-muted); }
  .apex-dark .nav-actions > a:not(.btn):hover { color: var(--on-dark); }
  .apex-dark header .btn-primary { background: var(--on-dark); color: var(--primary); }
  .apex-dark header .btn-primary:hover { background: rgba(255,255,255,0.85); color: var(--primary-hover); }

  .apex-dark .hero { background: var(--primary); color: var(--on-dark); }
  .apex-dark .hero h1 { color: var(--on-dark); }
  .apex-dark .hero .tagline { color: var(--on-dark-muted); }
  .apex-dark .hero .btn-primary, .apex-dark .final-cta .btn-primary { background: var(--on-dark); color: var(--primary); }
  .apex-dark .hero .btn-primary:hover, .apex-dark .final-cta .btn-primary:hover { background: rgba(255,255,255,0.85); color: var(--primary-hover); }
  .apex-dark .hero .btn-secondary { background: rgba(255,255,255,0.08); color: var(--on-dark); border-color: rgba(255,255,255,0.30); }
  .apex-dark .hero .btn-secondary:hover { background: rgba(255,255,255,0.16); color: var(--on-dark); border-color: rgba(255,255,255,0.5); }
  .apex-dark .hero-meta { color: rgba(255,255,255,0.55); }
  .apex-dark .hero-meta strong { color: var(--on-dark-muted); }

  .apex-dark .final-cta { background: var(--primary); color: var(--on-dark); }
  .apex-dark .final-cta h2 { color: var(--on-dark); }
  .apex-dark .final-cta p { color: var(--on-dark-muted); }

  .apex-dark footer { background: var(--primary); color: var(--on-dark-muted); border-top: none; }
  .apex-dark .footer-brand { color: var(--on-dark); }
  .apex-dark .footer-tagline { color: var(--on-dark-muted); }
  .apex-dark .footer-col h4 { color: var(--on-dark-muted); }
  .apex-dark .footer-col a { color: var(--on-dark-muted); }
  .apex-dark .footer-col a:hover { color: var(--on-dark); }
  .apex-dark .footer-bottom { border-top: 1px solid var(--on-dark-border); }
`;

const RESPONSIVE = `
  @media (max-width: 900px) {
    .hero-grid { grid-template-columns: 1fr; gap: 2.5rem; }
    .feature-grid { grid-template-columns: repeat(2, 1fr); }
    .price-grid { grid-template-columns: repeat(2, 1fr); }
    .footer-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 640px) {
    section { padding: 3.5rem 0; }
    .feature-grid, .price-grid, .trust-grid, .footer-grid { grid-template-columns: 1fr; }
  }
`;

// Dropdown nav entry (kind:"menu"): CSS-only, reveals on hover AND keyboard
// focus-within (the trigger is a real <button>, panel items are <a>). The panel
// is a light popover in BOTH themes — only the trigger color tracks the
// surrounding nav. Nav is hidden < 640px (CHROME_*), so this is desktop-only.
// Exported standalone so a consumer rendering its own header chrome (not the
// full apex page) can include just this, without duplicating the rules.
export const APEX_NAV_MENU_CSS = `
  .nav-menu { position: relative; display: inline-flex; }
  .nav-menu__trigger { display: inline-flex; align-items: center; gap: 0.3rem;
    font: inherit; font-size: 0.9375rem; color: var(--fg-muted);
    background: none; border: 0; padding: 0; cursor: pointer; }
  .nav-menu__trigger:hover { color: var(--fg); }
  .nav-menu__chev { font-size: 0.7em; transition: transform 0.15s; }
  .nav-menu:hover .nav-menu__chev, .nav-menu:focus-within .nav-menu__chev { transform: rotate(180deg); }
  .nav-menu__panel { position: absolute; top: calc(100% + 0.5rem); left: 0; z-index: 20;
    min-width: 21rem; padding: 0.5rem; background: var(--bg-card); color: var(--fg);
    border: 1px solid var(--border); border-radius: 0.75rem; box-shadow: var(--shadow);
    display: flex; flex-direction: column; gap: 0.125rem;
    opacity: 0; visibility: hidden; transform: translateY(0.375rem);
    transition: opacity 0.15s, transform 0.15s, visibility 0.15s; }
  .nav-menu:hover .nav-menu__panel, .nav-menu:focus-within .nav-menu__panel {
    opacity: 1; visibility: visible; transform: translateY(0); }
  .nav-menu__item { display: flex; gap: 0.75rem; align-items: flex-start;
    padding: 0.6rem 0.7rem; border-radius: 0.5rem; color: var(--fg); }
  .nav-menu__item:hover { background: var(--bg-muted); color: var(--fg); }
  .nav-menu__icon { flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 2rem; height: 2rem; border-radius: 0.5rem;
    background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); }
  .nav-menu__icon svg { width: 1.1rem; height: 1.1rem; }
  .nav-menu__text { display: flex; flex-direction: column; gap: 0.1rem; }
  .nav-menu__title { font-weight: 600; font-size: 0.9rem; line-height: 1.2; }
  .nav-menu__desc { font-size: 0.8rem; color: var(--fg-muted); line-height: 1.35; }
  .nav-menu__sep { height: 1px; background: var(--border); margin: 0.375rem 0.3rem; }
  .nav-menu__more { display: inline-flex; padding: 0.4rem 0.7rem; font-size: 0.85rem; font-weight: 600; color: var(--primary); }
  .nav-menu__more:hover { color: var(--primary-hover); }
  .apex-dark .nav-menu__trigger { color: var(--on-dark-muted); }
  .apex-dark .nav-menu__trigger:hover { color: var(--on-dark); }
`;

export const APEX_STRUCTURAL_CSS =
  BASE_LAYOUT +
  HERO +
  FEATURES +
  PRICING +
  TRUST +
  FINAL_CTA +
  CHROME_LIGHT +
  CHROME_DARK +
  APEX_NAV_MENU_CSS +
  RESPONSIVE;
