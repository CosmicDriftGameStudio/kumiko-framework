import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, testUserId } from "@cosmicdrift/kumiko-framework/stack";

export const probe = [setupTestStack, TestUsers, testUserId] as const;
