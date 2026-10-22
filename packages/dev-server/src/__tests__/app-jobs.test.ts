import { describe, expect, test } from "bun:test";
import { appJobsOf, stripAppJobs, withAppJobsOf } from "../managed-files/app-jobs.ts";

const WORKFLOW = `name: CI
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: bun test

  # Own seed check
  app-seed:
    runs-on: ubuntu-latest
    steps:
      - run: echo seed

  build:
    runs-on: ubuntu-latest
    steps:
      - run: bun build
`;

describe("app-owned workflow jobs", () => {
  test("stripAppJobs removes only app-* jobs and their intro comment", () => {
    const stripped = stripAppJobs(WORKFLOW);
    expect(stripped).not.toContain("app-seed");
    expect(stripped).not.toContain("Own seed check");
    expect(stripped).toContain("  test:");
    expect(stripped).toContain("  build:");
  });

  test("a workflow without app jobs is returned unchanged", () => {
    const plain = WORKFLOW.replace(/ {2}# Own seed check\n {2}app-seed:[\s\S]*?echo seed\n\n/, "");
    expect(stripAppJobs(plain)).toBe(plain);
    expect(appJobsOf(plain)).toBe("");
  });

  test("appJobsOf returns the job blocks including the intro comment", () => {
    const jobs = appJobsOf(WORKFLOW);
    expect(jobs).toContain("# Own seed check");
    expect(jobs).toContain("app-seed:");
    expect(jobs).not.toContain("build:");
  });

  test("withAppJobsOf appends the existing app jobs to a fresh render", () => {
    const rendered = "name: CI\njobs:\n  test:\n    runs-on: x\n";
    const merged = withAppJobsOf(rendered, WORKFLOW);
    expect(merged).toContain("  test:");
    expect(merged.endsWith("echo seed\n")).toBe(true);
    expect(stripAppJobs(merged)).toBe(stripAppJobs(rendered).replace(/\n+$/, "\n"));
  });

  test("withAppJobsOf leaves the render alone without app jobs", () => {
    expect(withAppJobsOf("name: CI\n", "name: CI\njobs:\n  test:\n    runs-on: x\n")).toBe(
      "name: CI\n",
    );
  });

  test("app jobs with a trailing comment or a quoted name are still recognised", () => {
    const content =
      "jobs:\n  test:\n    runs-on: x\n  app-a: # own check\n    runs-on: x\n  'app-b':\n    runs-on: x\n  build:\n    runs-on: x\n";
    expect(stripAppJobs(content)).toBe(
      "jobs:\n  test:\n    runs-on: x\n  build:\n    runs-on: x\n",
    );
    expect(appJobsOf(content)).toContain("app-a: # own check");
    expect(appJobsOf(content)).toContain("'app-b':");
  });

  test("a top-level key after jobs ends the last app job", () => {
    const content = "jobs:\n  app-x:\n    runs-on: x\nenv:\n  A: b\n";
    expect(stripAppJobs(content)).toBe("jobs:\nenv:\n  A: b\n");
  });
});
