import { requireRealProviders } from "../helpers/index.js";
import { setupTestStack } from "../stack/index.js";

export const probe = [requireRealProviders, setupTestStack] as const;
