import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  main as runObjectForm,
  transformObjectFormSource,
} from "../scripts/codemod/object-form.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "object-form");
const CODEMOD_SCRIPT = join(import.meta.dir, "..", "scripts", "codemod", "object-form.ts");

function readFixture(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES_DIR, `${name}.input.ts`), "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
  };
}

const FIXTURE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly rewrites: number;
  readonly manual: number;
}> = [
  { name: "write-handler", rewrites: 4, manual: 0 },
  { name: "query-handler", rewrites: 2, manual: 0 },
  { name: "entity", rewrites: 6, manual: 0 },
  { name: "requires", rewrites: 4, manual: 0 },
  { name: "requires-identifier", rewrites: 0, manual: 2 },
  { name: "hook", rewrites: 7, manual: 0 },
  { name: "crud", rewrites: 2, manual: 0 },
  { name: "crud-shared-import", rewrites: 1, manual: 0 },
  { name: "registrar-typed-helper", rewrites: 3, manual: 0 },
  { name: "not-a-registrar", rewrites: 0, manual: 0 },
  { name: "already-object-form", rewrites: 0, manual: 0 },
  { name: "manual", rewrites: 0, manual: 12 },
];

describe("object-form codemod fixtures", () => {
  for (const { name, rewrites, manual } of FIXTURE_CASES) {
    it(`${name}: output matches the expected file`, () => {
      const { input, expected } = readFixture(name);
      const result = transformObjectFormSource(input, `${name}.ts`);

      expect(result.output).toBe(expected);
      expect(result.rewrites).toHaveLength(rewrites);
      expect(result.manual).toHaveLength(manual);
    });

    it(`${name}: a second run on the expected file changes nothing`, () => {
      const { expected } = readFixture(name);
      const second = transformObjectFormSource(expected, `${name}.ts`);

      expect(second.output).toBe(expected);
      expect(second.rewrites).toHaveLength(0);
      expect(second.manual).toHaveLength(manual);
    });
  }
});

describe("object-form codemod behavior", () => {
  it("keeps comments from the options literal and before an argument", () => {
    const { expected } = readFixture("write-handler");

    expect(expected).toContain("// only the shop owner may cancel");
    expect(expected).toContain('name: /* wire name */ "order:archive"');
  });

  it("drops explicit type arguments from the rewritten call", () => {
    const { expected } = readFixture("write-handler");

    expect(expected).not.toContain("<typeof refundSchema>");
  });

  it("uses shorthand when the argument text equals the field name", () => {
    const { expected } = readFixture("write-handler");

    expect(expected).toContain(
      'r.writeHandler({ name: /* wire name */ "order:archive", schema, handler, access });',
    );
  });

  it("removes only the registerEntityCrud specifier when the import has other names", () => {
    const { expected } = readFixture("crud-shared-import");

    expect(expected.split("\n")[0]).toBe(
      'import { type CrudOptions, entityName } from "../engine";',
    );
  });

  it("rewrites a nested registrar call inside another rewritten call exactly once", () => {
    const result = transformObjectFormSource(
      [
        'defineFeature("x", (r) => {',
        '  r.writeHandler("a", s, () => {',
        '    r.hook("postSave", t, fn);',
        "  }, { access });",
        "});",
      ].join("\n"),
    );

    expect(result.rewrites.map((site) => site.method).sort()).toEqual(["hook", "writeHandler"]);
    expect(result.output).toContain('r.hook({ type: "postSave", target: t, handler: fn });');
    expect(result.output).not.toContain('r.hook("postSave"');
  });

  it("reports the source line of each rewritten call", () => {
    const { input } = readFixture("hook");
    const result = transformObjectFormSource(input, "hook.ts");

    expect(result.rewrites.map((site) => site.line)).toEqual([4, 6, 7, 8, 9, 10, 14]);
  });

  it("flags a spread argument and an unresolvable receiver as manual without rewriting", () => {
    const { input } = readFixture("manual");
    const result = transformObjectFormSource(input, "manual.ts");
    const reasons = result.manual.map((site) => site.why).join("\n");

    expect(result.output).toBe(input);
    expect(reasons).toContain("spread argument");
    expect(reasons).toContain("not a resolvable FeatureRegistrar");
    expect(reasons).toContain("referenced other than as a direct call");
  });

  it("treats unresolved receivers named in assumeRegistrarNames as registrars", () => {
    const snippet = 'ctx.requires("auth");\nreg.requires("auth");\nreg.entity("note", def);\n';
    const withoutAssumption = transformObjectFormSource(snippet);
    const assumed = transformObjectFormSource(snippet, "snippet.ts", {
      assumeRegistrarNames: new Set(["reg"]),
    });

    expect(withoutAssumption.output).toBe(snippet);
    expect(assumed.output).toBe(
      'ctx.requires("auth");\nreg.requires({ features: ["auth"] });\nreg.entity({ name: "note", ...def });\n',
    );
    expect(assumed.manual).toEqual([]);
  });
});

describe("object-form codemod CLI", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "object-form-cli-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeProjectFile(relativePath: string, content: string): string {
    const abs = join(workDir, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }

  async function runCodemod(...args: string[]): Promise<{ code: number; output: string }> {
    const lines: string[] = [];
    const capture = (...parts: unknown[]) => {
      lines.push(parts.join(" "));
    };
    const logSpy = spyOn(console, "log").mockImplementation(capture);
    const errorSpy = spyOn(console, "error").mockImplementation(capture);
    try {
      const code = await runObjectForm(args);
      return { code, output: lines.join("\n") };
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }

  // Real process: the bin wiring (import.meta.main -> process.exit with the exit code).
  async function spawnCodemod(...args: string[]): Promise<{ code: number; output: string }> {
    const proc = Bun.spawn({
      cmd: ["bun", CODEMOD_SCRIPT, ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, output: `${stdout}${stderr}` };
  }

  const POSITIONAL_SOURCE = [
    'import { registerEntityCrud } from "@cosmicdrift/kumiko-framework/engine";',
    'export const f = defineFeature("x", (r) => {',
    '  r.requires("users");',
    '  r.writeHandler("a", schema, handler, { access });',
    '  registerEntityCrud(r, "note", noteEntity);',
    "});",
    "",
  ].join("\n");

  it("--check exits 1 while positional calls remain and 0 after the write run", async () => {
    const file = writeProjectFile("src/feature.ts", POSITIONAL_SOURCE);

    const before = await spawnCodemod(workDir, "--check");
    expect(before.code).toBe(1);
    expect(before.output).toContain("writeHandler  rewritten");
    expect(readFileSync(file, "utf8")).toBe(POSITIONAL_SOURCE);

    const write = await runCodemod(workDir, "--no-format");
    expect(write.code).toBe(0);
    const written = readFileSync(file, "utf8");
    expect(written).toContain('r.requires({ features: ["users"] })');
    expect(written).toContain("r.crud(");
    expect(written).not.toContain("registerEntityCrud");

    const after = await runCodemod(workDir, "--check");
    expect(after.code).toBe(0);
  });

  it("--dry-run reports but changes nothing and exits 0", async () => {
    const file = writeProjectFile("src/feature.ts", POSITIONAL_SOURCE);

    const dryRun = await runCodemod(workDir, "--dry-run");

    expect(dryRun.code).toBe(0);
    expect(dryRun.output).toContain("rewritable: 3");
    expect(readFileSync(file, "utf8")).toBe(POSITIONAL_SOURCE);
  });

  it("the default write run exits 0 even when manual sites remain", async () => {
    writeProjectFile("src/feature.ts", "const r = make();\nr.entity('a', b);\n");

    const write = await runCodemod(workDir, "--no-format");

    expect(write.code).toBe(0);
    expect(write.output).toContain("manual: 1");
  });

  it("skips fixtures, declaration files and node_modules", async () => {
    const fixture = writeProjectFile("src/__tests__/fixtures/a.input.ts", POSITIONAL_SOURCE);
    const declaration = writeProjectFile("src/types.d.ts", POSITIONAL_SOURCE);
    const vendored = writeProjectFile("node_modules/pkg/index.ts", POSITIONAL_SOURCE);

    const check = await runCodemod(workDir, "--check");

    expect(check.code).toBe(0);
    for (const file of [fixture, declaration, vendored]) {
      expect(readFileSync(file, "utf8")).toBe(POSITIONAL_SOURCE);
    }
  });

  it("rejects conflicting mode flags with exit 2", async () => {
    const result = await runCodemod(workDir, "--check", "--dry-run");

    expect(result.code).toBe(2);
  });

  it("prints a hint instead of failing when no biome binary is installed", async () => {
    writeProjectFile("src/feature.ts", POSITIONAL_SOURCE);

    const write = await runCodemod(workDir);

    expect(write.code).toBe(0);
    expect(write.output).toContain("biome not found");
  });
});
