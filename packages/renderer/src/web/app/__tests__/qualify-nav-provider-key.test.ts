import { describe, expect, test } from "bun:test";
import { qualifyNavId } from "../../../index.ts";
import { qualifyNavProviderKey } from "../create-app.tsx";

// This cross-feature bridge merges the tree and navigation: a bundled-feature client
// provides its navProvider, while the app owns the r.nav node. If the NavTree node
// (schema QN) cannot find its provider, the entire publicstatus path silently fails
// after release, so this behavior is pinned here.

describe("qualifyNavProviderKey", () => {
  test("lokale id wird mit Feature-Namen qualifiziert (self-keyed)", () => {
    expect(qualifyNavProviderKey("cms", "content")).toBe("cms:nav:content");
  });

  test("bereits qualifizierte QN geht unverändert durch (App registriert Nav für bundled-feature)", () => {
    // The text-content client receives the publicstatus QN as navId. It must NOT be
    // qualified again as "text-content:nav:publicstatus:nav:content".
    expect(qualifyNavProviderKey("text-content", "publicstatus:nav:content")).toBe(
      "publicstatus:nav:content",
    );
  });

  test("self-keyed Fall ist konsistent mit qualifyNavId (Schema-Seite)", () => {
    // Both sides must produce the same QN; otherwise they do not match.
    expect(qualifyNavProviderKey("demo", "list")).toBe(qualifyNavId("demo", "list"));
  });
});
