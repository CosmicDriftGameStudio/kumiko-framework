import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { bridgeStub } from "@cosmicdrift/kumiko-framework/engine";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";

export const probe = [setupTestStack, TestUsers, bridgeStub, waitFor] as const;
