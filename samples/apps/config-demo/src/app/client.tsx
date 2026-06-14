import { configClient } from "@cosmicdrift/kumiko-bundled-features/config/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { configDemoClient } from "../features/demo/web";
import { AppShell } from "./shell";

// configClient() ships the generic config.settings.* audience labels; the
// app's own field labels live in configDemoClient.
createKumikoApp({ shell: AppShell, clientFeatures: [configClient(), configDemoClient] });
