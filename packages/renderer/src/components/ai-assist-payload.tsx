import { createContext, useContext } from "react";

// Context payload every aiAssist query of the surrounding form receives; set by the screen that
// knows what the form is about (actionForm: its load id or drawer row values).
const AiAssistPayloadContext = createContext<Readonly<Record<string, unknown>>>({});

export const AiAssistPayloadProvider = AiAssistPayloadContext.Provider;

export function useAiAssistPayload(): Readonly<Record<string, unknown>> {
  return useContext(AiAssistPayloadContext);
}
