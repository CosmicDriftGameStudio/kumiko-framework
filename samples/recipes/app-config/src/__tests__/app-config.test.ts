import { describe, expect, test } from "bun:test";
import {
  allAppFeatures,
  defineAppConfig,
  findAppPortProblems,
  listAppPorts,
} from "@cosmicdrift/kumiko-framework/config";
import appConfig from "../../kumiko.config";
import { notesFeature } from "../feature";

describe("kumiko.config.ts", () => {
  test("schema, agent lint and boot see features plus prodFeatures", () => {
    expect(allAppFeatures(appConfig).map((feature) => feature.name)).toEqual([
      "notes",
      "audit-export",
    ]);
  });

  test("ports list every claim, infrastructure included", () => {
    expect(listAppPorts(appConfig.ports)).toEqual([
      { role: "dev", port: 4510 },
      { role: "e2e", port: 4511 },
      { role: "postgres", port: 15510 },
    ]);
  });

  test("defineAppConfig rejects a port claimed twice inside the app", () => {
    const ports = { dev: 4510, e2e: 4510 };
    expect(findAppPortProblems(ports)).not.toEqual([]);
    expect(() =>
      defineAppConfig({ features: [notesFeature], client: { entries: ["src/client.tsx"] }, ports }),
    ).toThrow();
  });

  test("client entries must stay inside the app", () => {
    expect(() =>
      defineAppConfig({
        features: [notesFeature],
        client: { entries: ["../other-app/src/client.tsx"] },
        ports: { dev: 4510, e2e: 4511 },
      }),
    ).toThrow();
  });
});
