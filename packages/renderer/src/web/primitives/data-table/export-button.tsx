import { Download } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DataTableExport } from "../../../data-table-view-types.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { requestXlsxExport } from "../../lib/export-xlsx-request.ts";
import { saveBlobAsFile } from "../../lib/file-ref-download.ts";
import { Button as UiButton } from "../../ui/button.tsx";

type Outcome = { readonly kind: "too-many"; readonly maxRows: number | undefined } | "failed";

function localDateStamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function ExportButton({ source }: { readonly source: DataTableExport }): ReactNode {
  const translate = useOptionalTranslation();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);

  const run = async (): Promise<void> => {
    setBusy(true);
    setOutcome(undefined);
    const result = await requestXlsxExport(source);
    setBusy(false);
    if (result.status === "ok") {
      saveBlobAsFile(`${source.screenShortId}-${localDateStamp(new Date())}.xlsx`, result.blob);
    } else {
      setOutcome(
        result.status === "too-many" ? { kind: "too-many", maxRows: result.maxRows } : "failed",
      );
    }
  };

  const hint =
    outcome === undefined
      ? undefined
      : outcome === "failed"
        ? (translate?.("kumiko.list.export-failed") ?? "The export failed. Try again.")
        : (translate?.("kumiko.list.export-too-many", { max: outcome.maxRows ?? "" }) ??
          "Too many rows. Narrow the list with a filter and export again.");

  return (
    <>
      <UiButton
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={busy}
        onClick={() => void run()}
        data-testid="list-export"
      >
        <Download aria-hidden="true" />
        {busy
          ? (translate?.("kumiko.list.export-busy") ?? "Exporting…")
          : (translate?.("kumiko.list.export") ?? "Export")}
      </UiButton>
      {hint !== undefined && (
        <span
          role={outcome === "failed" ? "alert" : "status"}
          className="text-sm text-muted-foreground"
          data-testid="list-export-hint"
        >
          {hint}
        </span>
      )}
    </>
  );
}
