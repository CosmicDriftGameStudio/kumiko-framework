import { test } from "@playwright/test";
import { createAppDemo } from "../../scripts/demos/01-create-app.ts";
import { runDemo } from "./run-demo.ts";

test("hero: create-app — scaffold boots, login lands, notes feature appears", async ({
  page,
}) => {
  await runDemo(page, createAppDemo, { scaffoldName: "demo" });
});
