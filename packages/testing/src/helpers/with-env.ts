export async function withEnv<T>(
  overrides: Readonly<Record<string, string | undefined>>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      applyEnvValue(key, value);
    }
    return await run();
  } finally {
    for (const [key, value] of previous) {
      applyEnvValue(key, value);
    }
  }
}

// Assigning undefined would store the string "undefined", so absence must go through delete.
function applyEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
