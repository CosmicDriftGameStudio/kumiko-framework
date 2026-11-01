import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { helpdeskFeature, patFeature } from "./src/feature";

const PURGE_REASON =
  "Purging is an admin chore that stays in the app and is never offered to API clients.";

export default defineAppConfig({
  features: [createAuthFoundationFeature(), helpdeskFeature, patFeature(), localeDe()],
  includeBundled: true,
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4520, e2e: 4521, infra: { postgres: 15520 } },
  apiDocs: {
    appName: "Helpdesk",
    baseUrl: "https://helpdesk.example.com",
    locales: ["en", "de"],
    planNote: {
      en: "API tokens are included in every Helpdesk plan.",
      de: "API-Tokens sind in jedem Helpdesk-Tarif enthalten.",
    },
    webhookDelivery: {
      en: "Deliveries are signed so that you can verify the sender. A delivery that fails is retried a few times before it is dropped. Answer within a few seconds and treat repeated deliveries of the same event as one.",
      de: "Zustellungen sind signiert, damit du den Absender prüfen kannst. Eine fehlgeschlagene Zustellung wird einige Male wiederholt, bevor sie verworfen wird. Antworte innerhalb weniger Sekunden und behandle wiederholte Zustellungen desselben Ereignisses als eine.",
    },
    uiOnlyWrites: [
      {
        pattern: "helpdesk:write:ticket:purge",
        reason: PURGE_REASON,
      },
    ],
  },
});
