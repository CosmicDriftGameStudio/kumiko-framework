import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";

type EnvOverrides = Readonly<Record<string, string | undefined>>;

export async function withEnv<T>(
  overrides: EnvOverrides,
  run: () => T | Promise<T>,
): Promise<T> {
  const restore = applyEnvOverrides(overrides);
  try {
    return await run();
  } finally {
    restore();
  }
}

// Sets env around every test of the enclosing describe block and restores it afterwards.
export function withEnvForEachTest(overrides: EnvOverrides): void {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    restore = applyEnvOverrides(overrides);
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
}

// Sets env once for the enclosing describe block. Register it before any beforeAll that
// reads the env: hooks run in registration order.
export function withEnvForSuite(overrides: EnvOverrides): void {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    restore = applyEnvOverrides(overrides);
  });
  afterAll(() => {
    restore?.();
    restore = undefined;
  });
}

function applyEnvOverrides(overrides: EnvOverrides): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      applyEnvValue(key, value);
    }
  } catch (error) {
    for (const [key, value] of previous) applyEnvValue(key, value);
    throw error;
  }
  return () => {
    for (const [key, value] of previous) {
      applyEnvValue(key, value);
    }
  };
}

// Assigning undefined would store the string "undefined", so absence must go through delete.
function applyEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
