// injectSchema is shared by the dev-server (every HTML response) and
// prod-server (static-fallback index.html) paths. A bug here would be a
// silent production failure: createKumikoApp wouldn't find
// `window.__KUMIKO_SCHEMA__` and would mount empty. Tests pin idempotency
// plus the two insertion points (before the /client.js tag or before </body>).

import { describe, expect, test } from "bun:test";
import { injectSchema } from "../inject-schema";

const SCHEMA = '{"features":[]}';
const TAG = `<script>window.__KUMIKO_SCHEMA__=${SCHEMA};</script>`;

describe("injectSchema", () => {
  test("HTML mit /client.js-Tag: Schema-Tag wird DAVOR eingefügt", () => {
    const html = '<html><body><script src="/client.js" defer></script></body></html>';
    const out = injectSchema(html, SCHEMA);
    expect(out).toContain(TAG);
    // Schema MUST come before the client bundle — otherwise createKumikoApp()
    // runs before window.__KUMIKO_SCHEMA__ is set.
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('<script src="/client.js"'));
  });

  test("HTML mit module-form /client.js-Tag: Schema-Tag wird DAVOR eingefügt", () => {
    const html = '<html><body><script type="module" src="/client.js"></script></body></html>';
    const out = injectSchema(html, SCHEMA);
    expect(out).toContain(TAG);
    // Dev templates use `type="module"`, not the classic form — insertion
    // must match this tag pattern too.
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('<script type="module" src="/client.js"'));
  });

  test("HTML ohne /client.js-Tag: Schema-Tag wird vor </body> eingefügt", () => {
    const html = "<html><body><div id=root></div></body></html>";
    const out = injectSchema(html, SCHEMA);
    expect(out).toContain(TAG);
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf("</body>"));
  });

  test("HTML ohne </body>: Schema-Tag wird angehängt (defensiver Fallback)", () => {
    const html = "<div>fragment</div>";
    const out = injectSchema(html, SCHEMA);
    expect(out.endsWith(TAG)).toBe(true);
  });

  test("Idempotent: bei bereits injectem Schema kein zweiter Tag", () => {
    const html = `<html><body>${TAG}</body></html>`;
    const out = injectSchema(html, '{"features":[{"differentSchema":true}]}');
    // Original tag stays, no second tag added — the marker check otherwise
    // prevents stacking tags on repeated reads.
    expect(out).toBe(html);
  });

  test("Schema mit Komplex-Daten (entities + screens) bleibt valides JS", () => {
    const complex = JSON.stringify({
      features: [
        {
          featureName: "items",
          entities: { item: { fields: { title: { type: "text" } } } },
          screens: [{ id: "list", type: "entityList", entity: "item", columns: ["title"] }],
        },
      ],
    });
    const html = '<html><body><script src="/client.js"></script></body></html>';
    const out = injectSchema(html, complex);
    // Sanity: the injected script must be valid JS (object-literal syntax,
    // no HTML-reserved chars in the JSON that would break the <script>
    // block — JSON.stringify doesn't escape /, < etc., but the standard
    // chars used here are harmless).
    expect(out).toContain(`window.__KUMIKO_SCHEMA__=${complex}`);
  });

  test("Schema mit $-Replacement-Patterns bleibt byte-identisch (kein HTML-Splicing)", () => {
    // String.prototype.replace() interprets $$, $&, $`, $' specially in the
    // REPLACEMENT argument. The injected schema JSON string lands there — an
    // i18n label containing "$'" or similar would otherwise splice parts of
    // `html` into the script tag. A replacer-function argument sidesteps that.
    const dollarSchema = '{"label":"$\' tail $$ amp $& end"}';
    const dollarTag = `<script>window.__KUMIKO_SCHEMA__=${dollarSchema};</script>`;
    const html = '<html><body><script src="/client.js"></script></body></html>';
    const out = injectSchema(html, dollarSchema);
    // Insertion point is right before the /client.js tag, not the start of
    // the document — built via indexOf/slice, not .replace(), so the
    // expected value doesn't itself run through the same $-pattern footgun.
    const clientScriptIdx = html.indexOf('<script src="/client.js"');
    const expected = html.slice(0, clientScriptIdx) + dollarTag + html.slice(clientScriptIdx);
    expect(out).toBe(expected);
  });

  test("Schema mit $-Replacement-Patterns, Insertion vor </body>", () => {
    const dollarSchema = '{"label":"$\' tail $$ amp $& end"}';
    const dollarTag = `<script>window.__KUMIKO_SCHEMA__=${dollarSchema};</script>`;
    const html = "<html><body><div id=root></div></body></html>";
    const out = injectSchema(html, dollarSchema);
    // Built via slice/concat, not .replace() — the expected value must not
    // itself run through the same $-pattern footgun the fix removes.
    const bodyIdx = html.indexOf("</body>");
    const expected = html.slice(0, bodyIdx) + dollarTag + html.slice(bodyIdx);
    expect(out).toBe(expected);
  });
});
