import * as stack from "@cosmicdrift/kumiko-framework/stack";
import * as helpers from "@cosmicdrift/kumiko-framework/testing";

export const probe = [stack.TestUsers, helpers.waitFor] as const;
