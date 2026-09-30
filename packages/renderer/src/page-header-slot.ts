import { createContext, useContext } from "react";

// True while the screen renders below an app shell that offers page-header
// slots (see the PageHeader primitive). Embedded hosts (drawer, dashboard
// panel) reset it to false so their inner screens keep their own placement.
const PageHeaderSlotAvailableContext = createContext(false);

export const PageHeaderSlotAvailableProvider = PageHeaderSlotAvailableContext.Provider;

export function usePageHeaderSlotAvailable(): boolean {
  return useContext(PageHeaderSlotAvailableContext);
}
