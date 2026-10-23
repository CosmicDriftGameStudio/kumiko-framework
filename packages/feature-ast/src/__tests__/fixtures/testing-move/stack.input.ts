import { createTestDb, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const probe = [createTestDb, setupTestStack, defineFeature] as const;
export type Probe = TestStack;
