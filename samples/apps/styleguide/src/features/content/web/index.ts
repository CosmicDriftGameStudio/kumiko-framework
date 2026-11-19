import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { navProvider } from "./nav-provider";
import { PageEditor } from "./page-editor";

export function contentClient(): ClientFeatureDefinition {
  return {
    name: "content",
    navProviders: { content: navProvider },
    navEntities: { content: ["page"] },
    resolvers: { "content:edit": PageEditor },
  };
}
