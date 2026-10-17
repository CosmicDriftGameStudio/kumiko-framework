import * as stack from "@cosmicdrift/kumiko-framework/stack";
import * as helpers from "@cosmicdrift/kumiko-testing/helpers";

export const probe = [stack.TestUsers, helpers.waitFor] as const;
