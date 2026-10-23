import { setupTestStack, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { createTestUser } from "@cosmicdrift/kumiko-framework/stack";

export const probe = [setupTestStack, TestUsers, testTenantId, createTestUser] as const;
