// Provider-agnostic Test-Stack — re-exported from stack/test-stack.ts.
// setupBunTestStack / BunTestStack sind Aliase für setupTestStack / TestStack.
// "Bun" ist historisch, jetzt provider-neutral (DB_PROVIDER env).
export { setupTestStack as setupBunTestStack } from "../../stack/test-stack";
export type { TestStack as BunTestStack } from "../../stack/test-stack";
