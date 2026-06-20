// @runtime dev
//
// Dev-Server der Styleguide-Gallery. runDevApp ist ein [dev]-File → muss
// explizit markiert sein (sonst klassifiziert der Isolation-Guard das
// Default-Pfad-File als [runtime] und blockt den [dev]-Import).

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { contentFeature } from "../features/content/feature";
import { demoFeature } from "../features/demo/feature";
import { examplesFeature } from "../features/examples/feature";
import { galleryFeature } from "../features/gallery/feature";
import { seedStyleguideItems } from "./seed";

await runDevApp({
  features: [demoFeature, galleryFeature, examplesFeature, contentFeature],
  // Aktiviert die Upload-Routes (/api/files) + ctx.files für den Avatar-
  // Stresstest. In-Memory reicht für die Demo (nicht-persistent).
  files: { storageProvider: createInMemoryFileProvider() },
  port: Number.parseInt(process.env["PORT"] ?? "4180", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  seeds: [seedStyleguideItems],
});
