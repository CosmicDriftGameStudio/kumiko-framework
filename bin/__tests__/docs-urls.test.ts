import { describe, expect, test } from "bun:test";
import {
  WELCOME_DOC_LINKS,
  cliCommandDocUrl,
  cliIndexUrl,
  docsPageUrl,
} from "../docs-urls";

describe("docs-urls", () => {
  test("docsPageUrl uses /en/ prefix and trailing slash", () => {
    expect(docsPageUrl("cli")).toBe("https://docs.kumiko.rocks/en/cli/");
    expect(docsPageUrl("/quickstart/quickstart/")).toBe(
      "https://docs.kumiko.rocks/en/quickstart/quickstart/",
    );
  });

  test("cliCommandDocUrl slugifies colon commands", () => {
    expect(cliCommandDocUrl("dev")).toBe("https://docs.kumiko.rocks/en/cli/commands/dev/");
    expect(cliCommandDocUrl("check:fast")).toBe(
      "https://docs.kumiko.rocks/en/cli/commands/check-fast/",
    );
  });

  test("cliIndexUrl matches welcome CLI link", () => {
    expect(cliIndexUrl()).toBe("https://docs.kumiko.rocks/en/cli/");
    const cliLink = WELCOME_DOC_LINKS.find(([label]) => label === "CLI reference");
    expect(cliLink?.[1]).toBe(cliIndexUrl());
  });
});
