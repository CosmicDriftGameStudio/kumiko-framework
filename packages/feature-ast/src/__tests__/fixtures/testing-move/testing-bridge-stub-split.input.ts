import { bridgeStub, waitFor, type ManualClock } from "@cosmicdrift/kumiko-framework/testing";
import { expectError } from "@cosmicdrift/kumiko-framework/testing";

export const probe = [bridgeStub, waitFor, expectError] as const;
export type Probe = ManualClock;
