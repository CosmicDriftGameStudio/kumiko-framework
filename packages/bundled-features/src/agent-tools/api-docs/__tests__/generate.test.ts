import { describe, expect, test } from "bun:test";
import { generateApiDocs } from "../generate.ts";
import { fixtureConfig, fixtureInput } from "./fixtures.ts";

const NO_HTML_TAG = /<[A-Za-z]/;

function stripCode(markdown: string): string {
  const withoutFences = markdown.replace(/^```[\s\S]*?^```$/gm, "");
  return withoutFences.replace(/`[^`\n]*`/g, "");
}

describe("generateApiDocs", () => {
  const { files, problems } = generateApiDocs(fixtureInput());
  const file = (path: string): string => files.get(path) ?? "";

  test("emits overview, tokens, one reference page per scope, openapi and index per locale", () => {
    expect([...files.keys()].sort()).toEqual([
      "de/overview.md",
      "de/reference/tickets.md",
      "de/tokens.md",
      "en/overview.md",
      "en/reference/tickets.md",
      "en/tokens.md",
      "index.json",
      "openapi.json",
    ]);
  });

  test("tokens page carries the menu path per locale, the scope rows and the real rate limit", () => {
    expect(file("en/tokens.md")).toContain("Open Settings › API tokens.");
    expect(file("en/tokens.md")).toContain("Choose **Create a new token**.");
    expect(file("de/tokens.md")).toContain("Öffne Einstellungen › API-Tokens.");
    expect(file("en/tokens.md")).toContain("| `tickets` (Tickets) | `tickets:read` |");
    expect(file("en/tokens.md")).toContain(
      "| `tickets` (Tickets) | `tickets:write` | `ticketing:write:ticket:close`",
    );
    expect(file("en/tokens.md")).toContain("Each token may send 30 requests per 10 seconds.");
    expect(file("en/tokens.md")).not.toContain("feature_disabled");
  });

  test("a locale package translates a bundle key for the de token page", () => {
    expect(file("de/tokens.md")).toContain("Neuen Token erstellen");
    expect(file("en/tokens.md")).toContain("Create a new token");
  });

  test("the changes object of an update is expanded one level, labelled from the entity fields", () => {
    const page = file("en/reference/tickets.md");
    expect(page).toMatch(/\| `changes` \| object \|/);
    expect(page).toMatch(/\| `changes.title` \| string \| (yes|no) \|/);
  });

  test("reference uses short anchors, curl with the base URL and no response block without a recording", () => {
    const page = file("en/reference/tickets.md");
    expect(page).toContain("### ticket: close");
    expect(page).toContain("curl -X POST https://api.example.test/api/write \\");
    expect(page).toContain(`"reason": "solved"`);
    expect(page).not.toContain("Example response");
    expect(file("de/reference/tickets.md")).toContain("**Ticket schließen**");
    expect(file("de/reference/tickets.md")).toContain(
      '| `reason` | "solved" \\| "duplicate" | ja | Grund |',
    );
  });

  test("a recording adds the response block", () => {
    const withExample = generateApiDocs(
      fixtureInput({
        examples: [
          {
            fileName: "close.json",
            file: {
              request: {
                endpoint: "/api/write",
                body: {
                  type: "ticketing:write:ticket:close",
                  payload: { id: "x", reason: "solved" },
                },
              },
              response: { status: 200, body: { isSuccess: true } },
            },
          },
        ],
      }),
    );
    const page = withExample.files.get("en/reference/tickets.md") ?? "";
    expect(page).toContain("Status: 200");
    expect(page).toContain('"isSuccess": true');
  });

  test("a system-only handler the scope pattern matches is not documented and not reported as a UI write", () => {
    for (const [path, content] of files) {
      expect(content, path).not.toContain("ticket:sync");
    }
    const { problems } = generateApiDocs(fixtureInput());
    expect(JSON.stringify(problems)).not.toContain("ticket:sync");
  });

  test("handlers outside the scopes appear neither in markdown nor in openapi", () => {
    for (const [path, content] of files) {
      expect(content, path).not.toContain("internal:purge");
      expect(content, path).not.toContain("ticket:escalate");
    }
  });

  test("markdown is pure GFM: title and description frontmatter only, no HTML, alerts or id suffixes", () => {
    for (const [path, content] of files) {
      if (!path.endsWith(".md")) continue;
      const frontmatter = content.split("---\n")[1] ?? "";
      expect(
        frontmatter
          .split("\n")
          .filter(Boolean)
          .map((l) => l.split(":")[0]),
      ).toEqual(["title", "description"]);
      const prose = stripCode(content);
      expect(prose, path).not.toMatch(NO_HTML_TAG);
      expect(content, path).not.toMatch(/^> \[!/m);
      expect(content, path).not.toMatch(/\{#/);
      expect(content, path).not.toMatch(/^\s*(?:[-*]|\d+\.) \[/m);
      expect(content, path).not.toMatch(/[—–]/);
      expect(content.endsWith("\n") && !content.endsWith("\n\n"), path).toBe(true);
    }
  });

  test("the error table of the overview lists every documented code", () => {
    const overview = file("en/overview.md");
    for (const code of [
      "validation_error",
      "version_conflict",
      "rate_limit_unavailable",
      "member_read_timeout",
      "missing_token",
      "ambiguous_auth",
      "pat_rate_limited",
    ]) {
      expect(overview).toContain(`\`${code}\``);
    }
  });

  test("index.json lists anchors in document order, language independent, and every heading exists", () => {
    const index = JSON.parse(file("index.json"));
    const byPath = new Map<
      string,
      { anchors: { id: string; heading: string; level: number; qn?: string }[] }
    >(index.pages.map((page: { path: string }) => [page.path, page]));
    for (const name of ["overview", "tokens", "reference/tickets"]) {
      const en = byPath.get(`en/${name}.md`);
      const de = byPath.get(`de/${name}.md`);
      expect(en?.anchors.map((a) => a.id)).toEqual(de?.anchors.map((a) => a.id));
      for (const page of [en, de]) {
        const path = page === en ? `en/${name}.md` : `de/${name}.md`;
        const lines = new Set(file(path).split("\n"));
        for (const anchor of page?.anchors ?? []) {
          expect(lines.has(`${"#".repeat(anchor.level)} ${anchor.heading}`), anchor.heading).toBe(
            true,
          );
        }
      }
    }
    expect(byPath.get("en/reference/tickets.md")?.anchors).toContainEqual({
      id: "ticket-close",
      heading: "ticket: close",
      level: 3,
      qn: "ticketing:write:ticket:close",
    });
    expect(byPath.get("en/tokens.md")?.anchors.map((a) => a.id)).toEqual([
      "create-token",
      "use-token",
      "scopes",
      "rate-limit",
      "errors",
      "revoke-token",
      "security",
    ]);
  });

  test("openapi wrappers pin type.const to their mapping key and carry no $schema", () => {
    const text = file("openapi.json");
    expect(text).not.toContain("$schema");
    const spec = JSON.parse(text);
    const write = spec.paths["/api/write"].post.requestBody.content["application/json"].schema;
    expect(write.discriminator.propertyName).toBe("type");
    for (const [qn, target] of Object.entries<string>(write.discriminator.mapping)) {
      const schema = spec.components.schemas[target.replace("#/components/schemas/", "")];
      expect(schema.properties.type.const).toBe(qn);
    }
    expect(spec.info).toEqual({ title: "Helpdesk API", version: "1.2.3" });
    expect(spec.servers).toEqual([{ url: fixtureConfig.baseUrl }]);
  });

  test("deterministic: feature order does not change a single byte", () => {
    const reversed = generateApiDocs(fixtureInput({ reverse: true }));
    expect([...reversed.files]).toEqual([...files]);
    expect(reversed.problems).toEqual(problems);
  });
});
