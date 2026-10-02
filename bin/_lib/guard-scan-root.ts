export type GuardScanRoot =
  | { readonly kind: "use"; readonly path: string }
  | { readonly kind: "missing-scoped-repo"; readonly repo: string; readonly path: string };

/** A scoped run that cannot find its repo must fail: falling back to the
 *  framework checkout would run the guards against the wrong repo and report green. */
export function decideGuardScanRoot(input: {
  readonly scopedRepo: string | undefined;
  readonly scopedRepoPath: string | undefined;
  readonly scopedRepoExists: boolean;
  readonly anchorPath: string;
}): GuardScanRoot {
  if (input.scopedRepo === undefined || input.scopedRepoPath === undefined) {
    return { kind: "use", path: input.anchorPath };
  }
  if (!input.scopedRepoExists) {
    return { kind: "missing-scoped-repo", repo: input.scopedRepo, path: input.scopedRepoPath };
  }
  return { kind: "use", path: input.scopedRepoPath };
}
