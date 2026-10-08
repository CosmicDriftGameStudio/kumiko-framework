// Demo-Komponente für den `custom`-Dashboard-Panel-Typ: zeigt, dass eine
// eingehängte App-Komponente ihre Daten selbst holt und den aktuell
// gewählten Screen-Filter-Wert über `filterParams` sieht (siehe
// DashboardFilterDefinition in feature.ts).

import { type ExtensionSectionProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { SectionCard } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

export function DashboardFilterEcho({ filterParams }: ExtensionSectionProps): ReactNode {
  const t = useTranslation();
  const region = filterParams?.["region"];
  return (
    <SectionCard title={t("widgets:dashboard:filter-echo-title")}>
      <p className="text-sm text-muted-foreground">
        {typeof region === "string"
          ? t("widgets:dashboard:filter-echo-filtered", { region })
          : t("widgets:dashboard:filter-echo-unfiltered")}
      </p>
    </SectionCard>
  );
}
