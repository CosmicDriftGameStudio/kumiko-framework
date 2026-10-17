export async function load() {
  const { setupTestStack } = await import("@cosmicdrift/kumiko-framework/stack");
  const { TestUsers } = await import("@cosmicdrift/kumiko-framework/stack");
  return [setupTestStack, TestUsers] as const;
}

export type Stack = import("@cosmicdrift/kumiko-framework/stack").TestStack;
export type Users = typeof import("@cosmicdrift/kumiko-framework/stack");
export type Clock = import("@cosmicdrift/kumiko-framework/testing").ManualClock;
