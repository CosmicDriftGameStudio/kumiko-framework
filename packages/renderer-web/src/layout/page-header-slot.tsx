// Two portal targets (status, actions) plus a title override inside the
// ShellHeader, filled by the PageHeader primitive of whatever screen renders
// below it.
//
// Why a slot: the header sits above the content and is owned by the shell; a
// screen can only reach it through a portal. Same inversion as SidebarPanel.

import { PageHeaderSlotAvailableProvider } from "@cosmicdrift/kumiko-renderer";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

type SlotElement = HTMLElement | null;

export type PageHeaderSlot = {
  readonly statusElement: SlotElement;
  readonly actionsElement: SlotElement;
  readonly setStatusElement: (node: SlotElement) => void;
  readonly setActionsElement: (node: SlotElement) => void;
  readonly title: string | undefined;
  readonly setTitle: (title: string | undefined) => void;
};

const PageHeaderSlotContext = createContext<PageHeaderSlot | null>(null);

export function usePageHeaderSlot(): PageHeaderSlot | null {
  return useContext(PageHeaderSlotContext);
}

/** Shells wrap ShellHeader and the content area in it. */
export function PageHeaderSlotProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [statusElement, setStatusElement] = useState<SlotElement>(null);
  const [actionsElement, setActionsElement] = useState<SlotElement>(null);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const value = useMemo(
    () => ({ statusElement, actionsElement, setStatusElement, setActionsElement, title, setTitle }),
    [statusElement, actionsElement, title],
  );
  return (
    <PageHeaderSlotContext.Provider value={value}>
      <PageHeaderSlotAvailableProvider value={true}>{children}</PageHeaderSlotAvailableProvider>
    </PageHeaderSlotContext.Provider>
  );
}
