import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldDeploy } from "../scaffold-deploy";

describe("scaffoldDeploy", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kumiko-deploy-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("generates Dockerfile, Dockerfile.dockerignore, migrate-step.sh", () => {
    const result = scaffoldDeploy({ appName: "myapp", destination: tmp });
    expect(result.destination).toBe(join(tmp, "deploy"));
    expect(result.files).toHaveLength(3);
    expect(result.files.every((f) => f.written)).toBe(true);
    expect(existsSync(join(tmp, "deploy", "Dockerfile"))).toBe(true);
    expect(existsSync(join(tmp, "deploy", "Dockerfile.dockerignore"))).toBe(true);
    expect(existsSync(join(tmp, "deploy", "migrate-step.sh"))).toBe(true);
  });

  it("substitutes {{appName}} + {{port}} + {{githubOrg}}", () => {
    scaffoldDeploy({
      appName: "myapp",
      port: 4242,
      githubOrg: "acme",
      destination: tmp,
    });
    const dockerfile = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("Production-Image for myapp");
    expect(dockerfile).toContain("ENV PORT=4242");
    expect(dockerfile).toContain("EXPOSE 4242");

    const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
    expect(migrate).toContain("myapp pre-deploy migrate step");
    expect(migrate).toContain("ghcr.io/acme/myapp:latest");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell-substitution literal, not a JS template
    expect(migrate).toContain("postgresql://myapp:${DB_PASSWORD}@db:5432/myapp");
    // Docker template syntax {{.Name}} must pass through verbatim — our
    // placeholder regex only matches lowercase-leading identifiers.
    expect(migrate).toContain('"{{.Name}}"');
  });

  it("uses defaults when port + githubOrg are omitted", () => {
    scaffoldDeploy({ appName: "minimal", destination: tmp });
    const dockerfile = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("ENV PORT=3000");
    expect(dockerfile).toContain("EXPOSE 3000");

    const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
    expect(migrate).toContain("ghcr.io/cosmicdriftgamestudio/minimal:latest");
  });

  it("skips existing files by default", () => {
    const existing = join(tmp, "deploy");
    scaffoldDeploy({ appName: "first", destination: tmp });
    writeFileSync(join(existing, "Dockerfile"), "# user-tuned, do not touch");
    const second = scaffoldDeploy({ appName: "first", destination: tmp });
    const dockerfile = second.files.find((f) => f.path.endsWith("/Dockerfile"));
    expect(dockerfile?.written).toBe(false);
    expect(dockerfile?.reason).toBe("exists");
    expect(readFileSync(join(existing, "Dockerfile"), "utf-8")).toBe("# user-tuned, do not touch");
  });

  it("overwrites existing files with --force", () => {
    scaffoldDeploy({ appName: "first", destination: tmp });
    writeFileSync(join(tmp, "deploy", "Dockerfile"), "# old content");
    const second = scaffoldDeploy({ appName: "first", destination: tmp, force: true });
    const dockerfile = second.files.find((f) => f.path.endsWith("/Dockerfile"));
    expect(dockerfile?.written).toBe(true);
    expect(readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8")).toContain(
      "Production-Image for first",
    );
  });

  it("rejects appName that isn't kebab-case", () => {
    expect(() => scaffoldDeploy({ appName: "MyApp", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldDeploy({ appName: "my_app", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldDeploy({ appName: "1app", destination: tmp })).toThrow(/kebab-case/);
  });

  it("rejects out-of-range port", () => {
    expect(() => scaffoldDeploy({ appName: "x", port: 0, destination: tmp })).toThrow(/1\.\.65535/);
    expect(() => scaffoldDeploy({ appName: "x", port: 70000, destination: tmp })).toThrow(
      /1\.\.65535/,
    );
  });
});
