import { useEffect } from "react";
import type { ExtensionSectionProps } from "../app/extension-sections.js";

// Lets an extension wizard step report whether it already holds its data
// without a raw useEffect in app code (the no-raw-hooks guard forbids those).
// `complete === null` means the step's data is still loading: nothing is
// reported, so a loading step never flashes "not done" over a passed-via-Next
// state. Outside update-mode wizards `reportStepComplete` is undefined and the
// hook does nothing.
export function useReportStepComplete(
  reportStepComplete: ExtensionSectionProps["reportStepComplete"],
  complete: boolean | null,
): void {
  useEffect(() => {
    if (reportStepComplete !== undefined && complete !== null) reportStepComplete(complete);
  }, [reportStepComplete, complete]);
}
