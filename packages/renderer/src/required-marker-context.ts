import { createContext } from "react";

/** True inside a form that shows no required asterisk (all fields required, or `layout.hideRequiredMarker`). */
export const HideRequiredMarkerContext = createContext(false);
