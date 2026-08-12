// Injiziert das Server-aufgelöste AppSchema in das HTML-Template damit
// createKumikoApp() es synchron unter `window.__KUMIKO_SCHEMA__` vorfindet.
// JSON ist valides JS — direkt eingebettet, der Browser parsed das
// Object-Literal nativ.
//
// Geteilt zwischen dev-server (Schema kommt frisch aus dem laufenden
// Prozess) und prod-server (Schema wird beim Boot einmal berechnet und
// in die statisch ausgelieferte index.html injiziert). Beide Pfade
// nutzen dieselbe Tag-Form damit `createKumikoApp` den Lookup nicht je
// nach Kontext anders machen muss.
//
// Idempotenz: wenn das HTML schon einen __KUMIKO_SCHEMA__-Marker hat,
// wird nicht doppelt injected — verhindert dass repeated index.html-
// Reads (prod) oder bereits-vorbereitete templates (custom CI-builds)
// stacking-Tags produzieren.

// `<` als < serialisieren: verhindert `</script>`-Breakout aus dem
// RAWTEXT-Block, JSON bleibt valides JS.
function scriptSafeJsonHtml(json: string): string {
  return json.replace(/</g, "\\u003c");
}

const CLIENT_SCRIPT_TAG_RE = /<script\b[^>]*\ssrc="\/client\.js"/;

export function injectSchema(html: string, schemaJson: string): string {
  if (html.includes("__KUMIKO_SCHEMA__")) return html;
  const tag = `<script>window.__KUMIKO_SCHEMA__=${scriptSafeJsonHtml(schemaJson)};</script>`;
  const clientScriptMatch = html.match(CLIENT_SCRIPT_TAG_RE);
  if (clientScriptMatch) {
    return html.replace(CLIENT_SCRIPT_TAG_RE, (m) => `${tag}${m}`);
  }
  return html.includes("</body>") ? html.replace("</body>", () => `${tag}</body>`) : html + tag;
}
