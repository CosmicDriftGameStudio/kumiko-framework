import { describe, expect, test } from "bun:test";
import { parseChangesetChanges } from "../changeset-changes.js";

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

  test("keeps a blank line inside a multiline block as a paragraph break, not a truncation", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: breaking\ntitle: Removes the old flow\nmigration: |\n  First paragraph.\n\n  Second paragraph after a blank line.\n-->`,
      ".changeset/blank-line.md",
    );

    expect(changes[0]?.migration).toBe("First paragraph.\n\nSecond paragraph after a blank line.");
  });

  test("a trailing blank line ends the block's content and the next key parses as its own field", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: breaking\ntitle: Removes the old flow\ndetail: |\n  A.\n\nmigration: |\n  B.\n-->`,
      ".changeset/trailing-blank.md",
    );

    expect(changes[0]?.detail).toBe("A.");
    expect(changes[0]?.migration).toBe("B.");
  });

  test("a whitespace-only line with fewer than two spaces inside a block is a paragraph break", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: breaking\ntitle: Removes the old flow\nmigration: |\n  First.\n \n  Second.\n-->`,
      ".changeset/space-line.md",
    );

    expect(changes[0]?.migration).toBe("First.\n\nSecond.");
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

  test("fails clearly when a field value closes the block early with a --> line", () => {
    expect(() =>
      parseChangesetChanges(
        `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n<!-- kumiko-changes\nfeature: framework\ntype: breaking\ntitle: Removes the old flow\nmigration: |\n  Step one.\n  --> new\n-->`,
        ".changeset/early-close.md",
      ),
    ).toThrow("closed early");
  });

  test("derives title and detail per block from the prose before that block", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\nFirst feature title.\n\nFirst detail.\n\n<!-- kumiko-changes\nfeature: framework\ntype: improvement\n-->\n\nSecond feature title.\n\nSecond detail.\n\n<!-- kumiko-changes\nfeature: sessions\ntype: fix\n-->`,
      ".changeset/two-prose.md",
    );

    expect(changes.map(({ title, detail }) => ({ title, detail }))).toEqual([
      { title: "First feature title.", detail: "First detail." },
      { title: "Second feature title.", detail: "Second detail." },
    ]);
  });

  test("keeps the first prose line as detail when an explicit title differs from it", () => {
    const changes = parseChangesetChanges(
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\nBackground sentence.\n\n<!-- kumiko-changes\nfeature: framework\ntype: fix\ntitle: Short explicit title\n-->`,
      ".changeset/explicit-title.md",
    );

    expect(changes[0]).toMatchObject({
      title: "Short explicit title",
      detail: "Background sentence.",
    });
  });
});
