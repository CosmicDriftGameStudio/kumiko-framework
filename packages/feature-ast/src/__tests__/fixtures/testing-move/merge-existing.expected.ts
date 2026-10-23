import { TestUsers, testUserId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";

export const probe = [setupTestStack, TestUsers, testUserId] as const;
