import { describe, expect, test } from "bun:test";
import { qualifyNavId } from "@cosmicdrift/kumiko-renderer";
import { qualifyNavProviderKey } from "../create-app";

// Die Cross-Feature-Brücke des Tree→Nav-Merges: ein bundled-feature-Client
// liefert seinen navProvider, die App besitzt den r.nav-Knoten. Findet der
// NavTree-Knoten (Schema-QN) seinen Provider nicht, bricht der ganze
// publicstatus-Pfad still post-release — daher hier gepinnt.

describe("qualifyNavProviderKey", () => {
  test("lokale id wird mit Feature-Namen qualifiziert (self-keyed)", () => {
    expect(qualifyNavProviderKey("cms", "content")).toBe("cms:nav:content");
  });

  test("bereits qualifizierte QN geht unverändert durch (App registriert Nav für bundled-feature)", () => {
    // text-content-Client bekommt navId = die publicstatus-QN. Darf NICHT zu
    // "text-content:nav:publicstatus:nav:content" doppelt-qualifiziert werden.
    expect(qualifyNavProviderKey("text-content", "publicstatus:nav:content")).toBe(
      "publicstatus:nav:content",
    );
  });

  test("self-keyed Fall ist konsistent mit qualifyNavId (Schema-Seite)", () => {
    // Beide Seiten müssen denselben QN erzeugen, sonst kein Match.
    expect(qualifyNavProviderKey("demo", "list")).toBe(qualifyNavId("demo", "list"));
  });
});
