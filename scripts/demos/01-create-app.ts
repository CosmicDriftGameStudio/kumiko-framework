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

// Until Plan-Doc D7 ships (scaffold provides its own docker-compose +
// auto-generated .env), the scaffold's .env.example points at default
// `postgres:postgres@:5432` — Marc's recording stack runs on the kumiko
// dev compose (kumiko:kumiko@:15432, redis :16379). One editor step
// overwrites .env with those URLs so `bun dev` actually connects.
const ENV_SRC = `TEST_DATABASE_URL=postgres://kumiko:kumiko@127.0.0.1:15432/kumiko_demo_recording
REDIS_URL=redis://127.0.0.1:16379
JWT_SECRET=demo-recording-secret-min-32-chars-aaaaa
KUMIKO_SECRETS_MASTER_KEY_V1=aGVsbG90aGlzaXMzMmJ5dGVzZm9yYWVzMjU2a2V5cw==
KUMIKO_DEV_DB_NAME=kumiko_demo_recording
`;

export const createAppDemo = demo({
  title: "create-app",
  steps: [
    step.cli({
      // --yes skips the interactive feature picker (otherwise it blocks
      // tmux send-keys mid-recording). The Plan-Doc D14 one-liner stays
      // the same in marketing copy; the picker gets its own demo later.
      type: "curl -fsSL https://kumiko.rocks/install.sh | bash -s -- demo --yes",
      waitMs: 45_000, // bun install + scaffold runs inside the installer
      caption: { de: "Eine Zeile zum Start", en: "One line to start" },
    }),
    step.cli({
      type: "cd demo",
      waitMs: 800,
      caption: { de: "Ins Projekt wechseln", en: "Into the project" },
    }),
    step.editor({
      file: ".env",
      write: ENV_SRC,
      caption: { de: "Konfiguration", en: "Configuration" },
    }),
    step.cli({
      type: "bun dev",
      waitForPort: 3000,
      caption: { de: "Dev-Server starten", en: "Start the dev server" },
    }),
    step.browser({
      navigate: "http://localhost:3000/login",
      caption: { de: "Login öffnet sich", en: "Login screen appears" },
    }),
    step.browser({
      fill: {
        // Scaffold seeds admin@<scaffoldName>.local; the CLI step above
        // creates an app named "demo", so admin is admin@demo.local.
        // Password "changeme" is the dev-server default seed.
        "#login-email": "admin@demo.local",
        "#login-password": "changeme",
      },
      caption: { de: "Anmeldedaten eingeben", en: "Enter credentials" },
    }),
    step.browser({
      click: "button[type=submit]",
      // After login the DefaultAppShell renders the sidebar wrapper —
      // the nav-tree inside only appears once a feature registers nav
      // items the user has roles for, but the sidebar itself ships with
      // every scaffold and is the stable post-login landmark.
      waitFor: "[data-sidebar=sidebar]",
      caption: { de: "Anmelden", en: "Sign in" },
    }),
    // The notes feature is added but not auto-mounted into APP_FEATURES
    // (`kumiko-cli add feature` is DX-2 territory) — for the recording
    // viewer the file-write + reload + nav-click read as "edit a feature,
    // see it appear", which is the story the marketing GIF needs to tell.
    // The E2E runner skips these — verifying scaffold-boot + login is its
    // job, not the not-yet-shipped auto-mount.
    step.editor({
      file: "src/features/notes.ts",
      write: NOTES_FEATURE_SRC,
      recordingOnly: true,
      caption: { de: "Neues Feature hinzufügen", en: "Add a new feature" },
    }),
    step.browser({
      waitFor: "[data-test=nav-notes]",
      recordingOnly: true,
      caption: { de: "Reload → Notes erscheinen", en: "Reload → Notes appear" },
    }),
    step.browser({
      click: "[data-test=nav-notes]",
      recordingOnly: true,
      caption: { de: "CRUD-Screen ist live", en: "CRUD screen is live" },
    }),
  ],
});

export default createAppDemo;
