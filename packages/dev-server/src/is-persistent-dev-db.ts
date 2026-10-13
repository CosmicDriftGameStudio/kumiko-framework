export function isPersistentDevDb(env: Record<string, string | undefined> = process.env): boolean {
  const devDbName = env["KUMIKO_DEV_DB_NAME"];
  return devDbName !== undefined && devDbName !== "";
}
