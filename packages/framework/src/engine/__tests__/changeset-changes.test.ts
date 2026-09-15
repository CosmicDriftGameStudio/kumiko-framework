import { describe, expect, test } from "bun:test";
import { parseChangesetChanges } from "../changeset-changes";

describe("parseChangesetChanges", () => {
  test("parses a structured change and derives detail from the body", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\nAdds the new upgrade flow.\n\nMore detail.\n\n<!-- kumiko-changes\nfeature: framework\ntype: improvement\ntitle: Adds the new upgrade flow\n-->`,
      ".changeset/upgrade-flow.md",
    );

    expect(changes).toEqual([
      {
        feature: "framework",
        type: "improvement",
        title: "Adds the new upgrade flow",
        detail: "More detail.",
        source: ".changeset/upgrade-flow.md",
      },
    ]);
  });

  test("parses multiple blocks with multiline migration", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: breaking\ntitle: Removes the old flow\nmigration: |\n  Replace the old call.\n  Then run the migration.\n-->\n\n<!-- kumiko-changes\nfeature: sessions\ntype: fix\ntitle: Fixes session cleanup\n-->`,
      ".changeset/two-features.md",
    );

    expect(changes.map(({ feature, type, migration }) => ({ feature, type, migration }))).toEqual([
      {
        feature: "framework",
        type: "breaking",
        migration: "Replace the old call.\nThen run the migration.",
      },
      { feature: "sessions", type: "fix", migration: undefined },
    ]);
  });

  test("rejects a breaking change without migration", () => {
    expect(() =>
      parseChangesetChanges(
        `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: breaking\ntitle: Removes the old flow\n-->`,
        ".changeset/breaking.md",
      ),
    ).toThrow('breaking change "Removes the old flow" missing migration field');
  });

  test("rejects an unknown type", () => {
    expect(() =>
      parseChangesetChanges(
        `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: feature\ntitle: Invalid\n-->`,
        ".changeset/invalid.md",
      ),
    ).toThrow("type must be breaking, improvement, or fix");
  });
});
