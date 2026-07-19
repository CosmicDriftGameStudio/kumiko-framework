import { test } from "@playwright/test";
import { createAppDemo } from "../../scripts/demos/01-create-app.ts";
import { runDemo } from "./run-demo.ts";

test("hero: create-app — scaffold boots, login lands, notes feature appears", async ({
  page,
}) => {
  // Must match demo.yaml vars.appName ("hero-app") plus boot-demo.ts's scaffold dir,
  // otherwise fill-credentials templates an email for the wrong scaffold.
  await runDemo(page, createAppDemo, { scaffoldName: "hero-app" });
});
