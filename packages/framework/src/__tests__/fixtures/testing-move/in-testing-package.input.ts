import { requireRealProviders } from "@cosmicdrift/kumiko-framework/testing";
import { setupTestStack } from "@cosmicdrift/kumiko-framework/stack";

export const probe = [requireRealProviders, setupTestStack] as const;
