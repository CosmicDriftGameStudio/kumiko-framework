// Regression for #2065: scaffolded `tasks` demo feature had hardcoded nav
// labels ("Tasks", "New task") instead of i18n keys, invisible to
// guard-i18n-ui-strings because it only scans src/features/**/*.ts, not
// demo/src/... or the dev-server's own template strings.

import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import {
  createDemoTasksFeature,
  renderDemoTasksFeatureFile,
  renderDemoTasksI18n,
} from "../scaffold-demo-tasks";

describe("demo tasks feature nav labels are i18n keys (#2065)", () => {
  test("boot-validates with the tasks feature registered", () => {
    expect(() => validateBoot([createDemoTasksFeature()])).not.toThrow();
  });

  test("nav labels use tasks: i18n keys, not raw text", () => {
    const feature = createDemoTasksFeature();
    expect(feature.navs["tasks"]?.label).toBe("tasks:nav.tasks");
    expect(feature.navs["task-new"]?.label).toBe("tasks:nav.taskNew");
    expect(feature.translations?.["tasks:nav.tasks"]).toEqual({
      de: "Aufgaben",
      en: "Tasks",
      es: "Tareas",
    });
    expect(feature.translations?.["tasks:nav.taskNew"]).toEqual({
      de: "Neue Aufgabe",
      en: "New task",
      es: "Nueva tarea",
    });
  });

  test("renderDemoTasksFeatureFile() emits i18n keys, not raw nav labels", () => {
    const rendered = renderDemoTasksFeatureFile();
    expect(rendered).not.toContain('label: "Tasks"');
    expect(rendered).not.toContain('label: "New task"');
    expect(rendered).toContain('label: "tasks:nav.tasks"');
    expect(rendered).toContain('label: "tasks:nav.taskNew"');
  });

  test("renderDemoTasksI18n() bundles both nav-label keys for server + client", () => {
    const rendered = renderDemoTasksI18n();
    expect(rendered).toContain('"tasks:nav.tasks": { de: "Aufgaben", en: "Tasks", es: "Tareas" }');
    expect(rendered).toContain(
      '"tasks:nav.taskNew": { de: "Neue Aufgabe", en: "New task", es: "Nueva tarea" }',
    );
    expect(rendered).toContain('"tasks:nav.tasks": "Aufgaben"');
    expect(rendered).toContain('"tasks:nav.taskNew": "Neue Aufgabe"');
    expect(rendered).toContain('"tasks:nav.tasks": "Tasks"');
    expect(rendered).toContain('"tasks:nav.taskNew": "New task"');
  });
});
