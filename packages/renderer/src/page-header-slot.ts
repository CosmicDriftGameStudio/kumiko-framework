import { createContext, useContext } from "react";

// True while the screen renders below an app shell that offers page-header
// slots (see the PageHeader primitive). Embedded hosts (drawer, dashboard
// panel) reset it to false so their inner screens keep their own placement.
const PageHeaderSlotAvailableContext = createContext(false);

export const PageHeaderSlotAvailableProvider = PageHeaderSlotAvailableContext.Provider;

export function usePageHeaderSlotAvailable(): boolean {
  return useContext(PageHeaderSlotAvailableContext);
}

// True while a shell with page-header slots renders at phone width: screens
// then move secondary header actions into the shell's overflow menu.
const PageHeaderCompactContext = createContext(false);

export const PageHeaderCompactProvider = PageHeaderCompactContext.Provider;

export function usePageHeaderCompact(): boolean {
  return useContext(PageHeaderCompactContext);
}
