// Cross-Feature-Demo: demo-driver registriert eine Nav die sich
// selber zur driver-Workspace von `demo` zuweist. Beweist dass
// r.nav.workspaces QNs über Feature-Grenzen hinweg auflöst — nützlich
// für Teams die pro Persona ein eigenes Package haben und die an einen
// gemeinsamen Core anflanschen.

import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";

export const driverFeature: FeatureDefinition = defineFeature("demo-driver", (r) => {
  r.nav({
    id: "my-tour",
    label: "demo-driver:nav.myTour",
    workspaces: ["demo:workspace:driver"],
  });
});
