import { describe, expect, test } from "bun:test";
import { createTemplateResolverFeature } from "../feature.ts";

const REFUSED_KINDS = ["mail", "mail-layout", "pdf-layout"] as const;

// A tenant row of these kinds would shadow the system notification template
// without the meta and placeholder gates, so mounting such a collection fails at boot.
describe("collections refuse mail and layout kinds at mount", () => {
  for (const kind of REFUSED_KINDS) {
    test(`${kind} collection throws a clear boot error`, () => {
      expect(() =>
        createTemplateResolverFeature({
          collections: [
            {
              id: "entries",
              kind,
              access: { roles: ["Agent"] },
              nav: { label: "mail:nav.snippets" },
            },
          ],
        }),
      ).toThrow(`collection "entries" uses kind "${kind}", which collections may not write`);
    });
  }

  test("a text-block collection still mounts", () => {
    expect(() =>
      createTemplateResolverFeature({
        collections: [
          {
            id: "snippets",
            kind: "text-block",
            access: { roles: ["Agent"] },
            nav: { label: "mail:nav.snippets" },
          },
        ],
      }),
    ).not.toThrow();
  });
});
