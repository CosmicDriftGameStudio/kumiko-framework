// injectSchema teilt sich dev-server (every HTML response) und prod-
// server (static-fallback index.html) Pfad. Bug hier wäre stiller
// Production-Fail: createKumikoApp findet `window.__KUMIKO_SCHEMA__`
// nicht und mountet leer. Tests pinnen die Idempotenz + die zwei
// Insertion-Punkte (vor /client.js-Tag oder vor </body>).

import { describe, expect, test } from "bun:test";
import { injectSchema } from "../inject-schema";

const SCHEMA = '{"features":[]}';
const TAG = `<script>window.__KUMIKO_SCHEMA__=${SCHEMA};</script>`;

describe("injectSchema", () => {
  test("HTML mit /client.js-Tag: Schema-Tag wird DAVOR eingefügt", () => {
    const html = '<html><body><script src="/client.js" defer></script></body></html>';
    const out = injectSchema(html, SCHEMA);
    expect(out).toContain(TAG);
    // Schema MUSS vor dem Client-Bundle stehen — sonst läuft
    // createKumikoApp() bevor window.__KUMIKO_SCHEMA__ gesetzt ist.
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('<script src="/client.js"'));
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
    // Original-Tag bleibt, kein zweiter Tag hinzugefügt — der Marker-
    // Check verhindert sonst stacking-Tags bei repeated reads.
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
    // Sanity: das injected Skript muss valid JS sein (Object-Literal-
    // Syntax, keine HTML-Reserved-Chars im JSON die den <script>-Block
    // brechen würden — JSON.stringify entkommt /, < usw. nicht, aber
    // die Standard-Chars die wir hier nutzen sind unkritisch).
    expect(out).toContain(`window.__KUMIKO_SCHEMA__=${complex}`);
  });
});
