export async function load() {
  const { setupTestStack } = await import("@cosmicdrift/kumiko-testing/stack");
  const { TestUsers } = await import("@cosmicdrift/kumiko-framework/seeding");
  return [setupTestStack, TestUsers] as const;
}

export type Stack = import("@cosmicdrift/kumiko-testing/stack").TestStack;
export type Users = typeof import("@cosmicdrift/kumiko-framework/stack");
export type Clock = import("@cosmicdrift/kumiko-testing/helpers").ManualClock;
