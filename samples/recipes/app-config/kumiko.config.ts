import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";
import { auditExportFeature, notesFeature } from "./src/feature";

export default defineAppConfig({
  features: [notesFeature],
  prodFeatures: [auditExportFeature],
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4510, e2e: 4511, infra: { postgres: 15510 } },
});
