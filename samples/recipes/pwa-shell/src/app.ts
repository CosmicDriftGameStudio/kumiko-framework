import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { PwaOptions } from "@cosmicdrift/kumiko-server-runtime/pwa";

const noteEntity = createEntity({
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
  table: "pwa_shell_note",
});

export const notesFeature = defineFeature("pwa-notes", (r) => {
  r.entity({ name: "note", ...noteEntity });
});

// Icons live in public/ (dist/ after kumiko build); the boot rejects any src that is not a
// same-origin path.
export const pwa: PwaOptions = {
  name: "Field Notes",
  shortName: "Notes",
  themeColor: "#14532d",
  backgroundColor: "#ffffff",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};
