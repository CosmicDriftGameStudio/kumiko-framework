// @runtime client
import { createContext, type ReactNode, useContext } from "react";

export type PreviewRecordPickerProps = {
  readonly slug: string;
  readonly locale: string;
  readonly onPick: (values: Readonly<Record<string, unknown>>) => void;
};

// Slot for a consumer that can load a real record (the "pick a record" action). Without a provider the
// link stays hidden. Picked values replace the sample values in the preview and the test mail.
export type PreviewRecordPicker = {
  readonly label: string;
  readonly renderPicker: (props: PreviewRecordPickerProps) => ReactNode;
};

const PreviewRecordPickerContext = createContext<PreviewRecordPicker | null>(null);

export const PreviewRecordPickerProvider = PreviewRecordPickerContext.Provider;

export function usePreviewRecordPicker(): PreviewRecordPicker | null {
  return useContext(PreviewRecordPickerContext);
}
