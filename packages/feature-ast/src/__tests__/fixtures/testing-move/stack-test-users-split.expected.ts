import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers, testTenantId, createTestUser } from "@cosmicdrift/kumiko-framework/seeding";


export const probe = [setupTestStack, TestUsers, testTenantId, createTestUser] as const;
