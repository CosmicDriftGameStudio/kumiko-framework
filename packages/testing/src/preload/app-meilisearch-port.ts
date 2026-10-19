import { join } from "node:path";
import { APP_CONFIG_FILE } from "@cosmicdrift/kumiko-framework/config";

/** `ports.infra.meilisearch` of the app's kumiko.config.ts, read statically; undefined when not declared. */
export async function readAppMeilisearchPort(appRoot: string): Promise<number | undefined> {
  if (!(await Bun.file(join(appRoot, APP_CONFIG_FILE)).exists())) return undefined;
  // ts-morph loads only for apps that have a config file and no MEILI_URL.
  const { readStaticAppConfig } = await import("@cosmicdrift/kumiko-repo-manifest/app-ports");
  const config = readStaticAppConfig(appRoot);
  return config.kind === "defined" ? config.ports.infra?.meilisearch : undefined;
}
