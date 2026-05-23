import { kumikoDrizzleConfig } from "@cosmicdrift/kumiko-dev-server/drizzle-config";

// Convention-Defaults: schema=./drizzle/schema.ts, out=./drizzle/migrations,
// db url=process.env.DATABASE_URL, dialect=postgresql + verbose + strict.
export default kumikoDrizzleConfig();
