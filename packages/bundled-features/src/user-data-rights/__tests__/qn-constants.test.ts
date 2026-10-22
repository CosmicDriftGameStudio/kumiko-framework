import { describe, expect, test } from "bun:test";
import { createUserDataRightsFeature } from "../feature.ts";
import {
  USER_DATA_RIGHTS_FEATURE,
  UserDataRightsHandlers,
  UserDataRightsQueries,
} from "../web/constants.ts";

const qualify = (kind: "write" | "query", names: readonly string[]): string[] =>
  names.map((name) => `${USER_DATA_RIGHTS_FEATURE}:${kind}:${name}`).sort();

const qnValues = (map: Readonly<Record<string, string>>): string[] => Object.values(map).sort();

describe("user-data-rights QN constants", () => {
  const feature = createUserDataRightsFeature();

  test("UserDataRightsHandlers covers every registered write handler", () => {
    expect(qnValues(UserDataRightsHandlers)).toEqual(
      qualify("write", Object.keys(feature.writeHandlers)),
    );
  });

  test("UserDataRightsQueries covers every explicitly registered query handler", () => {
    const explicitQueryNames = Object.keys(feature.queryHandlers).filter(
      (name) => !name.includes(":"),
    );
    expect(qnValues(UserDataRightsQueries)).toEqual(qualify("query", explicitQueryNames));
  });
});
