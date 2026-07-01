// Single source of truth for ui-walkthrough feature composition.
//
// src/app/server.ts (dev boot) and kumiko/schema.ts (schema CLI) import
// from here — migration and runtime cannot drift.

import { taskFeature } from "./features/tasks";

export const APP_FEATURES = [taskFeature] as const;

// runDevApp auto-mounts config/user/tenant/auth-email-password when
// `auth: { … }` is set in server.ts (composeFeatures includeBundled).
export const HAS_AUTH = true;
