// Handler-header fields (access/rateLimit/escapeHatch/agent) authored as a
// non-literal reference must round-trip verbatim as a RawRefSentinel, or,
// for a fully literal but unrecognized value, report a ParseError.

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { parseSourceFile } from "../parse";
import type { FeaturePattern } from "../patterns";
import { renderFeatureFile } from "../render";

let fileCounter = 0;

function parse(source: string) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  fileCounter += 1;
  const sf = project.createSourceFile(`f-${fileCounter}.ts`, source);
  const result = parseSourceFile(sf);
  return result;
}

function findPattern(patterns: readonly FeaturePattern[], kind: FeaturePattern["kind"]) {
  const found = patterns.find((p) => p.kind === kind);
  if (!found) throw new Error(`no ${kind} pattern found`);
  return found;
}

const DEFAULT_IMPORTS = [
  'import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";',
  'import { z } from "zod";',
] as const;

describe("access: ADMIN, imported const (object form)", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { ADMIN } from "./access-consts";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: ADMIN,
  });
});
`;
  const result = parse(source);

  test("parses with no errors and keeps access as a raw sentinel", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({ access: { __raw: "ADMIN" } });
  });

  test("render → parse roundtrip keeps the reference verbatim", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
      imports: [...DEFAULT_IMPORTS, 'import { ADMIN } from "./access-consts";'],
    });
    expect(rendered).toContain("access: ADMIN,");
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "writeHandler");
    expect(reparsedPattern).toMatchObject({ access: { __raw: "ADMIN" } });
  });
});

describe('access: LOCAL, same-file const { roles: ["Admin"] }', () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const LOCAL = { roles: ["Admin"] };

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: LOCAL,
  });
});
`;
  const result = parse(source);

  test("keeps access as a raw sentinel even though LOCAL is same-file", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({ access: { __raw: "LOCAL" } });
  });

  test("render → parse roundtrip keeps the reference verbatim", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
      imports: [...DEFAULT_IMPORTS, 'const LOCAL = { roles: ["Admin"] };'],
    });
    expect(rendered).toContain("access: LOCAL,");
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "writeHandler");
    expect(reparsedPattern).toMatchObject({ access: { __raw: "LOCAL" } });
  });
});

describe("access: { roles: [ROLE_X] }, partially-literal object", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { ROLE_X } from "./roles";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: [ROLE_X] },
  });
});
`;
  const result = parse(source);

  test("keeps the whole initializer verbatim, not just ROLE_X", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({ access: { __raw: "{ roles: [ROLE_X] }" } });
  });

  test("render → parse roundtrip keeps the reference verbatim", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
      imports: [...DEFAULT_IMPORTS, 'import { ROLE_X } from "./roles";'],
    });
    expect(rendered).toContain("access: { roles: [ROLE_X] },");
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "writeHandler");
    expect(reparsedPattern).toMatchObject({ access: { __raw: "{ roles: [ROLE_X] }" } });
  });
});

describe('rateLimit: { disabled: true, reason: "x" }, fully literal RateLimitDisabled', () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: ["Admin"] },
    rateLimit: { disabled: true, reason: "x" },
  });
});
`;
  const result = parse(source);

  test("parses into a structured RateLimitDisabled value, not a raw sentinel", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({ rateLimit: { disabled: true, reason: "x" } });
  });

  test("render → parse roundtrip preserves the structured value", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "writeHandler");
    expect(reparsedPattern).toMatchObject({ rateLimit: { disabled: true, reason: "x" } });
  });
});

describe('access: { roles: ["anonymous"], personalData: PD }, non-literal sub-value', () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { PD } from "./pd";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: ["anonymous"], personalData: PD },
  });
});
`;
  const result = parse(source);

  test("keeps the whole initializer verbatim instead of narrowing to { roles }", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({
      access: { __raw: '{ roles: ["anonymous"], personalData: PD }' },
    });
  });
});

describe("shorthand access property, value previously lost", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const access = { roles: ["Admin"] };

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access,
  });
});
`;
  const result = parse(source);

  test("access is kept as a raw sentinel referencing the shorthand binding", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({ access: { __raw: "access" } });
  });
});

describe("positional form, both access and rateLimit authored as references", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { ADMIN } from "./access-consts";
import { LIMIT } from "./rate-limits";

defineFeature("f", (r) => {
  r.writeHandler("x", z.object({}), async () => {}, { access: ADMIN, rateLimit: LIMIT });
});
`;
  const result = parse(source);

  test("both header fields are kept as raw sentinels", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({
      access: { __raw: "ADMIN" },
      rateLimit: { __raw: "LIMIT" },
    });
  });

  test("render → parse roundtrip keeps both references verbatim", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
      imports: [
        ...DEFAULT_IMPORTS,
        'import { ADMIN } from "./access-consts";',
        'import { LIMIT } from "./rate-limits";',
      ],
    });
    expect(rendered).toContain("access: ADMIN,");
    expect(rendered).toContain("rateLimit: LIMIT,");
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "writeHandler");
    expect(reparsedPattern).toMatchObject({
      access: { __raw: "ADMIN" },
      rateLimit: { __raw: "LIMIT" },
    });
  });
});

describe("positional form, options argument is a bare identifier", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const OPTS = { access: { roles: ["Admin"] } };

defineFeature("f", (r) => {
  r.writeHandler("x", z.object({}), async () => {}, OPTS);
});
`;
  const result = parse(source);

  test("ParseErrors instead of silently dropping the whole header", () => {
    expect(result.patterns.some((p) => p.kind === "writeHandler")).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.methodName).toBe("writeHandler");
    expect(result.errors[0]?.reason).toContain("options argument");
  });
});

describe("fully literal but unrecognized access shape", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: "Admin" },
  });
});
`;
  const result = parse(source);

  test("ParseErrors instead of silently dropping access", () => {
    expect(result.patterns.some((p) => p.kind === "writeHandler")).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.methodName).toBe("writeHandler");
    expect(result.errors[0]?.reason).toContain("access");
  });
});

describe("escapeHatch: { reason: REASON }, non-literal reason", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { REASON } from "./reasons";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: ["Admin"] },
    escapeHatch: { reason: REASON },
  });
});
`;
  const result = parse(source);

  test("keeps the whole initializer verbatim", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({ escapeHatch: { __raw: "{ reason: REASON }" } });
  });
});

describe("streamHandler with a literal escapeHatch", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("f", (r) => {
  r.streamHandler({
    name: "x",
    schema: z.object({}),
    handler: async function* () { yield "token"; },
    access: { roles: ["Admin"] },
    escapeHatch: { reason: "r" },
  });
});
`;
  const result = parse(source);

  test("escapeHatch is kept as a structured value", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "streamHandler");
    expect(pattern).toMatchObject({ escapeHatch: { reason: "r" } });
  });

  test("render → parse roundtrip keeps escapeHatch", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
    });
    expect(rendered).toContain('escapeHatch: { reason: "r" },');
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "streamHandler");
    expect(reparsedPattern).toMatchObject({ escapeHatch: { reason: "r" } });
  });
});

describe("queryHandler with raw access", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { ADMIN } from "./access-consts";

defineFeature("f", (r) => {
  r.queryHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => ({}),
    access: ADMIN,
  });
});
`;
  const result = parse(source);

  test("keeps access as a raw sentinel", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "queryHandler");
    expect(pattern).toMatchObject({ access: { __raw: "ADMIN" } });
  });

  test("render → parse roundtrip keeps the reference verbatim", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
      imports: [...DEFAULT_IMPORTS, 'import { ADMIN } from "./access-consts";'],
    });
    expect(rendered).toContain("access: ADMIN,");
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "queryHandler");
    expect(reparsedPattern).toMatchObject({ access: { __raw: "ADMIN" } });
  });
});

describe("hook escapeHatch: { reason: REASON }, non-literal reason", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { REASON } from "./reasons";

defineFeature("f", (r) => {
  r.hook("postSave", "task", async (event, ctx) => {}, { escapeHatch: { reason: REASON } });
});
`;
  const result = parse(source);

  test("keeps the whole initializer verbatim", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "hook");
    expect(pattern).toMatchObject({ escapeHatch: { __raw: "{ reason: REASON }" } });
  });

  test("render → parse roundtrip keeps the reference verbatim", () => {
    const rendered = renderFeatureFile({
      featureName: result.featureName ?? "",
      patterns: result.patterns,
      imports: [...DEFAULT_IMPORTS, 'import { REASON } from "./reasons";'],
    });
    expect(rendered).toContain("escapeHatch: { reason: REASON },");
    const reparsed = parse(rendered);
    expect(reparsed.errors).toEqual([]);
    const reparsedPattern = findPattern(reparsed.patterns, "hook");
    expect(reparsedPattern).toMatchObject({ escapeHatch: { __raw: "{ reason: REASON }" } });
  });
});

describe("hook shorthand escapeHatch property", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const escapeHatch = { reason: "bulk reindex" };

defineFeature("f", (r) => {
  r.hook("postSave", "task", async (event, ctx) => {}, { escapeHatch });
});
`;
  const result = parse(source);

  test("escapeHatch is kept as a raw sentinel referencing the shorthand binding", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "hook");
    expect(pattern).toMatchObject({ escapeHatch: { __raw: "escapeHatch" } });
  });
});

describe("existing literal cases still produce structured values", () => {
  const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("f", (r) => {
  r.writeHandler({
    name: "x",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: ["Admin"] },
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
    agent: { expose: true, risk: "high" },
  });
});
`;
  const result = parse(source);

  test("access/rateLimit/agent are plain structured values, no sentinel", () => {
    expect(result.errors).toEqual([]);
    const pattern = findPattern(result.patterns, "writeHandler");
    expect(pattern).toMatchObject({
      access: { roles: ["Admin"] },
      rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
      agent: { expose: true, risk: "high" },
    });
  });
});
