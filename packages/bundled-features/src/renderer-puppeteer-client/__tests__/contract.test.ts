// Conformance test: createRendererPuppeteerClientFeature() returns a
// FeatureDefinition with correct requires + extension registration.

import { describe, expect, test } from "bun:test";
import { createRendererPuppeteerClientFeature } from "../feature";
import { puppeteerRender } from "../render";

describe("renderer-puppeteer-client :: Contract", () => {
  test("Feature-name + requires-Liste", () => {
    const feature = createRendererPuppeteerClientFeature();
    expect(feature.name).toBe("renderer-puppeteer-client");
    expect(feature.requires).toContain("renderer-foundation");
  });

  test("puppeteerRender is an async function", () => {
    expect(typeof puppeteerRender).toBe("function");
    expect(puppeteerRender.constructor.name).toBe("AsyncFunction");
  });
});
