import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { type ConsentTextView, useConsentFieldState } from "../consent-fields.tsx";

const BASE_TEXTS: ConsentTextView = {
  earlyPerformance: "early",
  withdrawalLoss: "loss",
  consentTextVersion: "v1",
};
const TEXTS_WITH_DOCUMENTS: ConsentTextView = {
  ...BASE_TEXTS,
  documentsAcknowledgement: "documents",
};

describe("useConsentFieldState", () => {
  test("with a documents text all three boxes are required and the payload carries the flag", () => {
    const { result } = renderHook(() => useConsentFieldState(TEXTS_WITH_DOCUMENTS));
    act(() => result.current.setCheck("earlyPerformance", true));
    act(() => result.current.setCheck("withdrawalLoss", true));
    expect(result.current.allGiven).toBe(false);
    act(() => result.current.setCheck("documentsAcknowledged", true));
    expect(result.current.allGiven).toBe(true);
    expect(result.current.buildPayload("de")).toEqual({
      earlyPerformanceRequested: true,
      withdrawalLossAcknowledged: true,
      documentsAcknowledged: true,
      consentTextVersion: "v1",
      locale: "de",
    });
  });

  test("without a documents text two boxes suffice and the payload omits the flag", () => {
    const { result } = renderHook(() => useConsentFieldState(BASE_TEXTS));
    act(() => result.current.setCheck("earlyPerformance", true));
    act(() => result.current.setCheck("withdrawalLoss", true));
    expect(result.current.allGiven).toBe(true);
    expect(result.current.buildPayload("de")).toEqual({
      earlyPerformanceRequested: true,
      withdrawalLossAcknowledged: true,
      consentTextVersion: "v1",
      locale: "de",
    });
  });
});
