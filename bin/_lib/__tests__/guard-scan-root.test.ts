import { describe, expect, test } from "bun:test";
import { decideGuardScanRoot } from "../guard-scan-root";

const anchorPath = "/work/kumiko-framework";

describe("decideGuardScanRoot", () => {
  test("unscoped run uses the framework anchor", () => {
    expect(
      decideGuardScanRoot({ scopedRepo: undefined, scopedRepoPath: undefined, scopedRepoExists: false, anchorPath }),
    ).toEqual({ kind: "use", path: anchorPath });
  });

  test("scoped run with an existing repo scans that repo", () => {
    expect(
      decideGuardScanRoot({ scopedRepo: "solon", scopedRepoPath: "/work/solon", scopedRepoExists: true, anchorPath }),
    ).toEqual({ kind: "use", path: "/work/solon" });
  });

  test("scoped run with a missing repo path is an error, never the framework fallback", () => {
    expect(
      decideGuardScanRoot({ scopedRepo: "solon", scopedRepoPath: "/work/.wt/solon", scopedRepoExists: false, anchorPath }),
    ).toEqual({ kind: "missing-scoped-repo", repo: "solon", path: "/work/.wt/solon" });
  });
});
