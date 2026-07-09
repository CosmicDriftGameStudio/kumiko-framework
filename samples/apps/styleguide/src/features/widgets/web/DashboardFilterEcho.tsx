// Demo-Komponente für den `custom`-Dashboard-Panel-Typ: zeigt, dass eine
// eingehängte App-Komponente ihre Daten selbst holt und den aktuell
// gewählten Screen-Filter-Wert über `filterParams` sieht (siehe
// DashboardFilterDefinition in feature.ts).

import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import { SectionCard } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

export function DashboardFilterEcho({ filterParams }: ExtensionSectionProps): ReactNode {
  const region = filterParams?.["region"];
  return (
    <SectionCard title="Custom-Panel">
      <p className="text-sm text-muted-foreground">
        {typeof region === "string"
          ? `Gefiltert nach Region: ${region}`
          : "Ungefiltert (alle Regionen)"}
      </p>
    </SectionCard>
  );
}
