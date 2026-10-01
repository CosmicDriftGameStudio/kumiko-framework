import { describe, expect, test } from "bun:test";
import { gitEnv } from "../git-env";

const ENV = {
  SSH_AUTH_SOCK: "/tmp/agent.sock",
  HTTPS_PROXY: "http://proxy:3128",
  GIT_DIR: "/hook/repo/.git",
  GIT_WORK_TREE: "/hook/repo",
  PATH: "/usr/bin",
};

describe("gitEnv", () => {
  test("transport opt-in passes SSH agent and proxy, never GIT_DIR/GIT_WORK_TREE", () => {
    const out = gitEnv(ENV, { transport: true });
    expect(out["SSH_AUTH_SOCK"]).toBe("/tmp/agent.sock");
    expect(out["HTTPS_PROXY"]).toBe("http://proxy:3128");
    expect(out["PATH"]).toBe("/usr/bin");
    expect(out).not.toHaveProperty("GIT_DIR");
    expect(out).not.toHaveProperty("GIT_WORK_TREE");
  });

  test("default stays narrow: no SSH agent, no proxy, no GIT_DIR", () => {
    const out = gitEnv(ENV);
    expect(out).toEqual({ PATH: "/usr/bin" });
  });
});
