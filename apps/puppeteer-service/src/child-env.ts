import { AUTH_TOKEN_ENV_VAR } from "./config";

// Chromium and poppler parse untrusted input; a memory leak there must not expose the auth
// token that would otherwise sit in every child's environment block.
export function childProcessEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === AUTH_TOKEN_ENV_VAR || typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}
