import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseStatusFrontmatter, statusDocHygieneWarnings } from "../_lib/doc-status";
import { check } from "../guard-doc-status";
import { fixtureRoot } from "./parent-workspace-fixture";

function frontmatter(lines: readonly string[]): string {
  return `---\n${lines.join("\n")}\n---\n\n# Title\n`;
}

describe("parseStatusFrontmatter", () => {
  test("accepts a complete reference doc", () => {
    const parsed = parseStatusFrontmatter(
      frontmatter(["status: reference", "verified: 2026-10-25"]),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.frontmatter?.status).toBe("reference");
  });

  test("rejects a file without frontmatter or with an unclosed block", () => {
    expect(parseStatusFrontmatter("# Title\n").problems).toEqual([
      "no status frontmatter (file must start with '---')",
    ]);
    expect(parseStatusFrontmatter("---\nstatus: idea\n").problems).toEqual([
      "frontmatter is not closed (second '---' missing)",
    ]);
  });

  test("rejects an unknown status and a non-ISO verified date", () => {
    const parsed = parseStatusFrontmatter(
      frontmatter(["status: accepted", "verified: 25.10.2026"]),
    );
    expect(parsed.problems).toEqual([
      expect.stringContaining("status 'accepted' is invalid"),
      "verified '25.10.2026' is not an ISO date (YYYY-MM-DD)",
    ]);
  });

  test("enforces the status-dependent fields", () => {
    const missing = (status: string) =>
      parseStatusFrontmatter(frontmatter([`status: ${status}`, "verified: 2026-10-25"])).problems;
    expect(missing("shipped")).toEqual([expect.stringContaining("needs evidence")]);
    expect(missing("superseded")).toEqual(["status 'superseded' needs superseded-by"]);
    expect(missing("in-progress")).toEqual(["status 'in-progress' needs next (one line)"]);
    expect(missing("blocked")).toEqual(["status 'blocked' needs next (one line)"]);
  });

  test("accepts depends as a block list and rejects bullets under other fields", () => {
    const parsed = parseStatusFrontmatter(
      frontmatter([
        "status: idea",
        "verified: 2026-10-25",
        "depends:",
        "  - kumiko-platform:docs/plans/x.md",
      ]),
    );
    expect(parsed.frontmatter?.depends).toEqual(["kumiko-platform:docs/plans/x.md"]);
    const bullet = parseStatusFrontmatter(
      frontmatter([
        "status: idea",
        "verified: 2026-10-25",
        "next: x",
        "  - kumiko-platform:docs/x.md",
      ]),
    );
    expect(bullet.problems).toEqual([expect.stringContaining("block list item under 'next'")]);
  });
});

describe("statusDocHygieneWarnings", () => {
  function warningsFor(relPath: string, lines: readonly string[]): readonly string[] {
    return statusDocHygieneWarnings({ relPath, ...parseStatusFrontmatter(frontmatter(lines)) });
  }

  test("warns about an active spec without issue and a finished plan outside the archive", () => {
    expect(
      warningsFor("docs/plans/a.md", ["status: in-progress", "verified: 2026-10-25", "next: x"]),
    ).toEqual([expect.stringContaining("without issue")]);
    expect(
      warningsFor("docs/plans/a.md", ["status: shipped", "verified: 2026-10-25", "evidence: #1"]),
    ).toEqual([expect.stringContaining("move it to docs/archive/plans/")]);
  });

  test("warns about malformed depends refs only", () => {
    expect(
      warningsFor("docs/reference/a.md", [
        "status: idea",
        "verified: 2026-10-25",
        "depends: [kumiko-framework#12, infra:docs/x.md, owner/repo#3 (Sprint 2), docs/rfc#42.md]",
      ]),
    ).toEqual(["depends 'docs/rfc#42.md' is neither 'repo#issue' nor 'repo:path.md'"]);
  });
});

describe("doc-status check over a repo", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function makeRepo(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "doc-status-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content, "utf-8");
    }
    return fixtureRoot("repo", dir, { kind: "app", sourceRoots: ["src"], testGlobs: [] });
  }

  test("reports broken docs and skips archive, templates and generated plan indexes", async () => {
    const valid = frontmatter(["status: reference", "verified: 2026-10-25"]);
    const root = makeRepo({
      "docs/reference/ok.md": valid,
      "docs/runbooks/broken.md": "# no frontmatter\n",
      "docs/plans/STATUS.md": "# generated\n",
      "docs/plans/archive/old.md": "# old\n",
      "docs/plans/templates/readme.md": "# template\n",
      "docs/guides/untracked.md": "# guides are not status docs\n",
    });
    const outcome = await check.run([root]);
    expect(outcome.matchedFiles).toBe(2);
    expect(outcome.violations).toEqual([
      {
        file: "docs/runbooks/broken.md",
        line: 1,
        message: "no status frontmatter (file must start with '---')",
      },
    ]);
  });

  test("repo without status doc dirs is not applicable", async () => {
    const root = makeRepo({ "README.md": "# repo\n" });
    expect((await check.run([root])).notApplicable).toBe(true);
  });
});
