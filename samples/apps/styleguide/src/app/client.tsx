import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { styleguideClient } from "../features/demo/web";
import { galleryClient } from "../features/gallery/web";
import { AppShell } from "./shell";

// Schema kommt vom dev-server via window.__KUMIKO_SCHEMA__. styleguideClient
// liefert die Feld-Label-Übersetzungen, galleryClient die custom Gallery-Screen.
createKumikoApp({ shell: AppShell, clientFeatures: [styleguideClient, galleryClient] });
