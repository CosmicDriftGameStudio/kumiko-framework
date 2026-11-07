import { createHandbookKnowledgeFeature } from "@cosmicdrift/kumiko-bundled-features/handbook-knowledge";

// In an app this object is the output of `kumiko handbuch knowledge <config> --out <file>`.
const handbook = {
  defaultLocale: "en",
  locales: {
    en: [
      {
        id: "prozess-add-tenant",
        kind: "process" as const,
        title: "Add a tenant",
        questions: ["How do I add a tenant?"],
        screens: [],
        bodyMd: "Open the lease, choose Add tenant and confirm the change.",
      },
      {
        id: "lease-detail",
        kind: "screen" as const,
        title: "Lease",
        questions: [],
        screens: [],
        bodyMd: "The lease screen shows tenants, rent and documents.",
      },
    ],
    de: [
      {
        id: "prozess-add-tenant",
        kind: "process" as const,
        title: "Mieter hinzufügen",
        questions: ["Wie füge ich einen Mieter hinzu?"],
        screens: [],
        bodyMd: "Vertrag öffnen, Mieter hinzufügen wählen und die Änderung bestätigen.",
      },
    ],
  },
};

export const handbookKnowledgeFeature = createHandbookKnowledgeFeature({
  pages: handbook,
  access: { roles: ["User"] },
  publicPath: "/handbuch",
});
