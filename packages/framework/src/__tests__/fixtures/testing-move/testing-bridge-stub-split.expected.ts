import { bridgeStub } from "@cosmicdrift/kumiko-framework/engine";
import { waitFor, type ManualClock, expectError } from "@cosmicdrift/kumiko-testing/helpers";


export const probe = [bridgeStub, waitFor, expectError] as const;
export type Probe = ManualClock;
