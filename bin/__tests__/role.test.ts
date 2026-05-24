import { afterEach, describe, expect, test } from "bun:test";
import { makeTempCwd } from "../commands/_test-helpers";
import { detectRole } from "../role";
import { join } from "node:path";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmp(files: Record<string, string>): string {
  const t = makeTempCwd(files);
  cleanups.push(t.cleanup);
  return t.cwd;
}

describe("role detection", () => {
  test("--as override wins regardless of cwd", () => {
    const cwd = tmp({ "package.json": '{"name":"my-random-app"}' });
    expect(detectRole(cwd, ["--as", "maintainer"])).toBe("maintainer");
    expect(detectRole(cwd, ["--as", "app-dev"])).toBe("app-dev");
  });

  test("cosmicdriftgamestudio workspace-root → maintainer", () => {
    const cwd = tmp({ "package.json": '{"name":"cosmicdriftgamestudio","private":true}' });
    expect(detectRole(cwd, [])).toBe("maintainer");
  });

  test("kumiko-framework sub-repo → maintainer", () => {
    const cwd = tmp({ "package.json": '{"name":"kumiko-framework"}' });
    expect(detectRole(cwd, [])).toBe("maintainer");
  });

  test("kumiko-platform sub-repo → maintainer", () => {
    const cwd = tmp({ "package.json": '{"name":"kumiko-platform"}' });
    expect(detectRole(cwd, [])).toBe("maintainer");
  });

  test("app with @cosmicdrift/kumiko-framework dep → app-dev", () => {
    const cwd = tmp({
      "package.json": '{"name":"my-app","dependencies":{"@cosmicdrift/kumiko-framework":"*"}}',
    });
    expect(detectRole(cwd, [])).toBe("app-dev");
  });

  test("app with @cosmicdrift/kumiko-dev-server dep → app-dev", () => {
    const cwd = tmp({
      "package.json": '{"name":"my-app","devDependencies":{"@cosmicdrift/kumiko-dev-server":"*"}}',
    });
    expect(detectRole(cwd, [])).toBe("app-dev");
  });

  test("no markers → app-dev (safe default)", () => {
    const cwd = tmp({ "README.md": "hi" });
    expect(detectRole(cwd, [])).toBe("app-dev");
  });

  test("walks up to find marker", () => {
    const cwd = tmp({
      "package.json": '{"name":"kumiko-framework"}',
      "deep/nested/dir/.gitkeep": "",
    });
    const nested = join(cwd, "deep/nested/dir");
    expect(detectRole(nested, [])).toBe("maintainer");
  });

  test(".cdgs-maintainer marker file forces maintainer", () => {
    const cwd = tmp({
      ".cdgs-maintainer": "",
      "package.json": '{"name":"some-random-thing"}',
    });
    expect(detectRole(cwd, [])).toBe("maintainer");
  });

  test("invalid --as is ignored (falls back to detection)", () => {
    const cwd = tmp({ "package.json": '{"name":"kumiko-framework"}' });
    expect(detectRole(cwd, ["--as", "bogus"])).toBe("maintainer");
  });
});
