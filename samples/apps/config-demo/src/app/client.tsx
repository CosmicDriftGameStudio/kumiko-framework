import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { configDemoClient } from "../features/demo/web";
import { AppShell } from "./shell";

createKumikoApp({ shell: AppShell, clientFeatures: [configDemoClient] });
