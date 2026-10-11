export const PAGE_STYLES = `
:root{
  --bg:#f3f4f1;--panel:#fff;--ink:#14161a;--muted:#5f645d;--line:#dfe2dc;
  --accent:#2b5cff;--accent-ink:#fff;--warn:#b4541a;--warn-bg:#fbeee4;
  --frame:#1b1d22;--stage:#e8eae4;--code-bg:#eef0eb;
  --font-sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#101216;--panel:#171a1f;--ink:#eceee8;--muted:#9aa096;--line:#2a2e35;
  --accent:#5b82ff;--accent-ink:#0c0e12;--warn:#f0a36a;--warn-bg:#2e2119;
  --frame:#050608;--stage:#0c0e11;--code-bg:#22262c}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--ink);font-family:var(--font-sans);font-size:15px;line-height:1.6;overflow-x:hidden}
[hidden]{display:none!important}
a{color:var(--accent)}
code{font-family:var(--font-mono);font-size:.88em;background:var(--code-bg);padding:.1em .35em;border-radius:4px;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
.app{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}
aside{background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;min-height:0}
.brand{padding:20px 20px 14px;border-bottom:1px solid var(--line)}
.brand h1{font-size:19px;margin:0;line-height:1.25}
.build-info{margin:6px 0 0;font-family:var(--font-mono);font-size:11px;color:var(--muted);line-height:1.5}
.stats{font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:10px;display:flex;gap:4px 12px;flex-wrap:wrap}
.stats b{color:var(--ink);font-weight:600}
nav{overflow:auto;padding:8px 0 24px;flex:1}
nav h3{font-family:var(--font-mono);font-weight:500;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 20px 6px}
nav a{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 20px;color:var(--ink);text-decoration:none;font-size:13.5px;line-height:1.3}
nav a:hover{background:var(--stage)}
nav a:focus-visible,.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
nav a[aria-current="true"]{background:var(--accent);color:var(--accent-ink)}
.tag{font-family:var(--font-mono);font-size:10px;padding:1px 6px;border-radius:99px;white-space:nowrap;margin-left:4px}
.tag.warn{background:var(--warn-bg);color:var(--warn)}
nav a[aria-current="true"] .tag{background:var(--accent-ink);color:var(--accent)}
main{min-width:0}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
.bar .title{flex:1 1 220px;min-width:0;font-size:16px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{all:unset;cursor:pointer;padding:6px 12px;font-size:12.5px;font-weight:500;color:var(--muted)}
.seg button+button{border-left:1px solid var(--line)}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.hint{font-family:var(--font-mono);font-size:11px;color:var(--muted)}
.content{padding:24px}
.chapter{max-width:1900px;margin:0 auto}
.chapter-head h2{margin:0 0 6px;font-size:26px;line-height:1.25;text-wrap:balance}
.meta{margin:0 0 18px;color:var(--muted);font-size:13px}
.stage-col{background:var(--stage);border-radius:12px;padding:20px;margin-bottom:24px;min-width:0}
.text-col{min-width:0}
.prose{max-width:46rem;min-width:0}
.prose h3{font-size:19px;margin:1.8em 0 .5em}
.prose h4{font-size:16px;margin:1.4em 0 .4em}
.prose p,.prose li{overflow-wrap:anywhere}
.prose table{display:block;overflow-x:auto;border-collapse:collapse;max-width:100%}
.prose th,.prose td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
.prose pre{overflow-x:auto;background:var(--code-bg);padding:12px;border-radius:8px}
.shot{margin:1.2em 0}
.shot img{display:block;border:1px solid var(--line);border-radius:8px}
.shot figcaption,.frame figcaption{font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:6px}
.frame figcaption{text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px}
.badge{font-family:var(--font-mono);font-size:11px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;margin-right:6px}
.notice{font-size:13px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.gap-box{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:12px 14px;max-width:46rem}
.frames{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;justify-content:center}
.frame{margin:0;min-width:0;max-width:100%}
.dev{background:var(--frame);padding:10px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
.dev.desktop{padding-top:26px;border-radius:10px;position:relative}
.dev.desktop::before{content:"";position:absolute;top:10px;left:12px;width:8px;height:8px;border-radius:50%;background:#ff5f57;box-shadow:14px 0 #febc2e,28px 0 #28c840}
.dev.mobile{border-radius:26px}
.dev img{display:block;width:100%;border-radius:4px}
.dev.mobile img{border-radius:18px}
.dev a{display:block}
html[data-vp="desktop"] .frame:not([data-vp="desktop"]),
html[data-vp="tablet"] .frame:not([data-vp="tablet"]),
html[data-vp="mobile"] .frame:not([data-vp="mobile"]){display:none}
html:not([data-vp="all"]) .frame[data-vp="desktop"]{width:min(1600px,100%)}
html:not([data-vp="all"]) .frame[data-vp="tablet"]{width:min(880px,100%)}
html:not([data-vp="all"]) .frame[data-vp="mobile"]{width:min(390px,100%)}
html[data-vp="all"] .frame[data-vp="desktop"]{width:min(720px,100%)}
html[data-vp="all"] .frame[data-vp="tablet"]{width:min(460px,100%)}
html[data-vp="all"] .frame[data-vp="mobile"]{width:min(240px,100%)}
.lb-close{position:fixed;top:12px;right:16px;z-index:2;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer}
#lightbox{width:100vw;height:100vh;max-width:none;max-height:none;padding:0;border:0;background:rgba(8,10,14,.88)}
#lightbox::backdrop{background:rgba(8,10,14,.88)}
.lb-scroll{position:absolute;inset:0;overflow:auto;padding:56px 16px 24px;text-align:center}
.lb-scroll img{max-width:100%;height:auto;cursor:zoom-out;border-radius:6px;background:#fff}
a[data-large]{cursor:zoom-in}
.steps{display:grid;gap:32px;margin-top:8px}
.step h3{margin:0 0 10px;font-size:19px}
.step-text{margin-top:14px}
.stat-row{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 20px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 18px;min-width:120px}
.stat b{display:block;font-size:28px;line-height:1.1}
.stat span{color:var(--muted);font-size:13px}
.stat.warn b{color:var(--warn)}
.mobile-pick{display:none}
@media (max-width:760px){
  .app{grid-template-columns:minmax(0,1fr)}
  aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  nav{display:none}
  .mobile-pick{display:block;padding:0 16px}
  .mobile-pick label{display:block;font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-bottom:6px}
  .mobile-pick select{width:100%;padding:8px;font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px}
  .brand{padding:16px 16px 12px;border-bottom:0}
  .bar .title{display:none}
  .bar{padding:10px 16px;position:static}
  .content{padding:16px}
  .stage-col{padding:12px}
  .hint{display:none}
}
`;

export const PAGE_SCRIPT = `
const VIEWPORTS = Object.entries(VIEWPORT_LABELS);
const store = {
  get(key){try{return localStorage.getItem(key)}catch{return null}},
  set(key,value){try{localStorage.setItem(key,value)}catch{}}
};
const root = document.documentElement;
let availableViewports = VIEWPORTS;
const sections = [...document.querySelectorAll("section.chapter")];
const ids = sections.map(s => s.dataset.nav);
const savedLocale = store.get("hb-locale");
const savedViewport = store.get("hb-vp");
const defaultViewport = matchMedia("(max-width:760px)").matches ? "mobile" : "desktop";
const state = {
  locale: LOCALES.includes(savedLocale) ? savedLocale : DEFAULT_LOCALE,
  vp: VIEWPORTS.some(v => v[0] === savedViewport) ? savedViewport : defaultViewport,
  id: ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : ids[0]
};
function segment(el, options, key, labelOf, pressedValue){
  el.textContent = "";
  for (const option of options){
    const value = option[0];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labelOf(option);
    button.setAttribute("aria-pressed", String((pressedValue !== undefined ? pressedValue : state[key]) === value));
    button.onclick = () => { state[key] = value; store.set(key === "locale" ? "hb-locale" : "hb-vp", value); render(); };
    el.append(button);
  }
}
function go(id){ state.id = id; history.replaceState(null, "", "#" + id); render(); window.scrollTo(0, 0); }
function render(){
  root.dataset.locale = state.locale;
  root.dataset.vp = state.vp;
  root.lang = state.locale;
  let active = null;
  for (const section of sections){
    section.hidden = section.dataset.nav !== state.id;
    if (!section.hidden) active = section;
  }
  for (const link of document.querySelectorAll("[data-nav-link]")){
    const on = link.dataset.navLink === state.id;
    if (on) link.setAttribute("aria-current", "true"); else link.removeAttribute("aria-current");
  }
  document.getElementById("pick").value = state.id;
  const heading = active && active.querySelector('.chapter-head [data-loc="' + state.locale + '"] h2, .chapter-head > h2');
  document.getElementById("bar-title").textContent = heading ? heading.textContent : "";
  const hasMatrix = Boolean(active && active.dataset.matrix);
  segment(document.getElementById("seg-locale"), LOCALES.map(l => [l]), "locale", o => o[0].toUpperCase());
  const present = ((active && active.dataset.vps) || "").split(" ").filter(Boolean);
  const options = VIEWPORTS.filter(v => v[0] === "all" ? present.length > 1 : present.includes(v[0]));
  availableViewports = options;
  const effective = options.some(v => v[0] === state.vp) ? state.vp : (options[0] ? options[0][0] : state.vp);
  root.dataset.vp = effective;
  segment(document.getElementById("seg-vp"), options, "vp", o => o[1], effective);
  document.getElementById("seg-vp").hidden = !hasMatrix;
  document.getElementById("seg-locale").hidden = LOCALES.length < 2;
  const activeLink = document.querySelector('nav [aria-current="true"]');
  if (activeLink) activeLink.scrollIntoView({block: "nearest"});
}
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (ids.includes(id) && id !== state.id){ state.id = id; render(); window.scrollTo(0, 0); }
});
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lb-img");
function closeLightbox(){ if (lightbox.open) lightbox.close(); lightboxImage.removeAttribute("src"); }
document.addEventListener("click", e => {
  const link = e.target.closest("a[data-large]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || typeof lightbox.showModal !== "function") return;
  e.preventDefault();
  lightboxImage.alt = link.querySelector("img").alt;
  lightboxImage.src = link.dataset.large;
  lightbox.showModal();
  lightbox.querySelector(".lb-scroll").scrollTop = 0;
});
document.getElementById("lb-close").onclick = closeLightbox;
document.getElementById("lb-scroll").addEventListener("click", () => closeLightbox());
lightbox.addEventListener("close", () => lightboxImage.removeAttribute("src"));
document.getElementById("pick").onchange = e => go(e.target.value);
document.getElementById("nav").addEventListener("click", e => {
  const link = e.target.closest("[data-nav-link]");
  if (link){ e.preventDefault(); go(link.dataset.navLink); }
});
addEventListener("keydown", e => {
  if (lightbox.open || e.target.closest("select") || e.metaKey || e.ctrlKey || e.altKey) return;
  const i = ids.indexOf(state.id);
  if (e.key === "ArrowDown" && i < ids.length - 1){ e.preventDefault(); go(ids[i + 1]); }
  else if (e.key === "ArrowUp" && i > 0){ e.preventDefault(); go(ids[i - 1]); }
  else if (e.key.length === 1 && "1234".includes(e.key)){
    const active = sections.find(s => !s.hidden);
    if (active && active.dataset.matrix){ const pick = availableViewports[Number(e.key) - 1]; if (!pick) return; state.vp = pick[0]; store.set("hb-vp", state.vp); render(); }
  }
});
render();
`;
