import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export function LeaseHubHeader(): ReactNode {
  return (
    <p data-testid="lease-hub-header" className="text-sm text-muted-foreground">
      Mietverhältnis seit 2019 · Kaution hinterlegt · nächste Mietanpassung zum 01.01.2027
    </p>
  );
}

const HISTORY_ENTRIES = [
  "01.01.2019 Vertragsbeginn",
  "01.04.2021 Indexmiete angepasst",
  "01.04.2023 Staffelmiete angepasst",
  "01.01.2025 Nebenkosten angepasst",
] as const;

export function LeaseHubHistory({ entityId }: ExtensionSectionProps): ReactNode {
  return (
    <ul data-testid="lease-hub-history" data-entity-id={entityId ?? ""} className="space-y-2 p-4">
      {HISTORY_ENTRIES.map((entry) => (
        <li key={entry} className="text-sm">
          {entry}
        </li>
      ))}
    </ul>
  );
}
