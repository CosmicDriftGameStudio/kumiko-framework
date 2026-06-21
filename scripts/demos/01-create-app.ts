// Hero demo (Phase 3, Plan-Doc D14 + D8). The recorder produces a 60s
// split-screen GIF — CLI on the left, browser on the right — that becomes
// `apps/marketing/public/hero/demo.gif` in the kumiko-platform repo.
//
// The story is the one Marc tells in person: empty terminal → one-liner →
// running app → login → add a new feature → CRUD screen appears. Each step
// has German + English captions; the HTML overlay (D11) reads them out of
// the recorder's captions.json next to the GIF.

import { demo } from "./demo";
import { step } from "./step";

const NOTES_FEATURE_SRC = `import { defineFeature } from "@cosmicdrift/kumiko-framework";

export const notesFeature = defineFeature("notes", (r) => {
  r.entity("note", {
    fields: {
      title: r.text().required(),
      body: r.text(),
    },
  });
});
`;

export default demo({
  title: "create-app",
  steps: [
    step.cli({
      type: "curl -fsSL https://kumiko.rocks/install.sh | bash -s -- demo",
      caption: { de: "Eine Zeile zum Start", en: "One line to start" },
    }),
    step.cli({
      type: "cd demo && bun install",
      caption: { de: "Abhängigkeiten installieren", en: "Install dependencies" },
    }),
    step.cli({
      type: "docker compose up -d",
      caption: { de: "Postgres + Redis hochfahren", en: "Bring up Postgres + Redis" },
    }),
    step.cli({
      type: "bun dev",
      caption: { de: "Dev-Server starten", en: "Start the dev server" },
    }),
    step.browser({
      navigate: "http://localhost:3000/login",
      caption: { de: "Login öffnet sich", en: "Login screen appears" },
    }),
    step.browser({
      click: "[data-test=login-submit]",
      caption: { de: "Anmelden als admin@demo.local", en: "Sign in as admin@demo.local" },
    }),
    step.browser({
      waitFor: "[data-test=app-shell]",
      caption: { de: "App-Shell ist da", en: "App shell is up" },
    }),
    step.editor({
      file: "src/features/notes.ts",
      write: NOTES_FEATURE_SRC,
      caption: { de: "Neues Feature hinzufügen", en: "Add a new feature" },
    }),
    step.browser({
      waitFor: "[data-test=nav-notes]",
      caption: { de: "Reload → Notes erscheinen", en: "Reload → Notes appear" },
    }),
    step.browser({
      click: "[data-test=nav-notes]",
      caption: { de: "CRUD-Screen ist live", en: "CRUD screen is live" },
    }),
  ],
});
