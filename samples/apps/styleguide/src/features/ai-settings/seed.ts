import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

import { ANTHROPIC_CONNECTION_ID, OPENROUTER_CONNECTION_ID } from "./catalog";
import { connectionEntity } from "./feature";

export const seedAiConnections: SeedFn = async (stack) => {
  const { executor } = createEntityExecutor("connection", connectionEntity);
  const tenantDb = createTenantDb(stack.db, TestUsers.admin.tenantId);
  const connections = [
    {
      id: ANTHROPIC_CONNECTION_ID,
      name: "Anthropic",
      provider: "anthropic",
      apiKey: "sk-ant-demo",
    },
    { id: OPENROUTER_CONNECTION_ID, name: "OpenRouter", provider: "openrouter" },
  ];
  for (const connection of connections) {
    const result = await executor.create(connection, TestUsers.admin, tenantDb);
    if (!result.isSuccess) {
      // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
      console.error(`[seed] ai connection ${connection.name} failed:`, result.error);
      return;
    }
  }
};
