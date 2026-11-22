import { describe, expect, test } from "bun:test";
import { KumikoBootError, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import {
  isFinalLetterState,
  isLetterTransitionAllowed,
  LETTER_EVENT_OF_STATE,
  LETTER_STATE_OF_PROVIDER_STATE,
  LETTER_STATE_TIMESTAMP_FIELD,
  LETTER_STATES,
  LETTER_TRANSITIONS,
  type LetterState,
} from "../constants.ts";
import { letterEnvSchema } from "../env-schema.ts";

describe("letter transition table", () => {
  test("every pair is allowed exactly when the table lists it", () => {
    for (const from of LETTER_STATES) {
      for (const to of LETTER_STATES) {
        expect(isLetterTransitionAllowed(from, to)).toBe(LETTER_TRANSITIONS[from].includes(to));
      }
    }
  });

  test("a letter never skips approval and never leaves a final state", () => {
    expect(isLetterTransitionAllowed("awaiting-approval", "submitting")).toBe(false);
    expect(isLetterTransitionAllowed("awaiting-approval", "sent")).toBe(false);
    for (const final of ["failed", "canceled", "returned"] as const) {
      expect(isFinalLetterState(final)).toBe(true);
      for (const to of LETTER_STATES) expect(isLetterTransitionAllowed(final, to)).toBe(false);
    }
  });

  test("an unknown submission resolves to accepted or failed only", () => {
    expect(LETTER_TRANSITIONS["submission-unknown"]).toEqual(["accepted", "failed"]);
    expect(isLetterTransitionAllowed("sent", "returned")).toBe(true);
    expect(isFinalLetterState("sent")).toBe(false);
  });

  test("every state a letter can enter has a timestamp column and an event", () => {
    const enterable = LETTER_STATES.filter((state: LetterState) => state !== "awaiting-approval");
    expect(Object.keys(LETTER_STATE_TIMESTAMP_FIELD).sort()).toEqual([...enterable].sort());
    expect(Object.keys(LETTER_EVENT_OF_STATE).sort()).toEqual([...enterable].sort());
  });

  test("provider states map to letter states the table can reach from acceptance or sending", () => {
    for (const state of Object.values(LETTER_STATE_OF_PROVIDER_STATE)) {
      const reachable =
        isLetterTransitionAllowed("accepted", state) || isLetterTransitionAllowed("sent", state);
      expect(reachable || state === "accepted").toBe(true);
    }
  });
});

describe("letter live switch", () => {
  test("aborts the boot outside production", () => {
    expect(() => parseEnv(letterEnvSchema, { LETTER_LIVE: "true", NODE_ENV: "test" })).toThrow(
      KumikoBootError,
    );
  });

  test("boots in production and without the switch", () => {
    expect(parseEnv(letterEnvSchema, { LETTER_LIVE: "true", NODE_ENV: "production" })).toEqual({
      LETTER_LIVE: "true",
    });
    expect(parseEnv(letterEnvSchema, { LETTER_LIVE: "false", NODE_ENV: "test" })).toEqual({
      LETTER_LIVE: "false",
    });
    expect(parseEnv(letterEnvSchema, { NODE_ENV: "test" })).toEqual({});
  });
});
