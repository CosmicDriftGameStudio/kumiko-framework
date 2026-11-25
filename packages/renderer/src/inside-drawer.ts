import { createContext, useContext, useEffect } from "react";

// True while a form renders inside the Drawer primitive (DrawerHost). The form
// then drops its own title and card chrome (the drawer header carries the
// title) and lays out as scrolling body plus pinned footer.
const InsideDrawerContext = createContext(false);

export const InsideDrawerProvider = InsideDrawerContext.Provider;

export function useInsideDrawer(): boolean {
  return useContext(InsideDrawerContext);
}

// The hosting drawer's close request (asks before discarding unsaved input). An actionForm
// with `cancelInDrawer` wires its Cancel button to it.
const DrawerCloseRequestContext = createContext<(() => void) | undefined>(undefined);

export const DrawerCloseRequestProvider = DrawerCloseRequestContext.Provider;

export function useDrawerCloseRequest(): (() => void) | undefined {
  return useContext(DrawerCloseRequestContext);
}

// True while a drawer-hosted detail shows a form in its own panel instead of a second drawer; the
// form's fields then flow side by side like on a page, instead of stacking like in a narrow drawer.
const InPlaceFormContext = createContext(false);

export const InPlaceFormProvider = InPlaceFormContext.Provider;

export function useInPlaceForm(): boolean {
  return useContext(InPlaceFormContext);
}

// True for a drawer-hosted detail under a flat header: its section cards and lists bring the 24px
// gutter themselves, so the form around them adds none.
const FlushDrawerBodyContext = createContext(false);

export const FlushDrawerBodyProvider = FlushDrawerBodyContext.Provider;

export function useFlushDrawerBody(): boolean {
  return useContext(FlushDrawerBodyContext);
}

// True in the footer form of a detail: a file input then fits a narrow column, the file name on its
// own line above the buttons.
const NarrowFileInputContext = createContext(false);

export const NarrowFileInputProvider = NarrowFileInputContext.Provider;

export function useNarrowFileInput(): boolean {
  return useContext(NarrowFileInputContext);
}

// Escape inside a drawer-hosted detail closes a form shown in place before it closes the drawer.
export type DrawerEscapeHandlerRef = { current: (() => boolean) | undefined };

const DrawerEscapeContext = createContext<DrawerEscapeHandlerRef | undefined>(undefined);

export const DrawerEscapeProvider = DrawerEscapeContext.Provider;

/** Claims Escape while mounted: the handler returns true when it consumed the key. */
export function useDrawerEscapeHandler(handler: (() => boolean) | undefined): void {
  const ref = useContext(DrawerEscapeContext);
  useEffect(() => {
    if (ref === undefined || handler === undefined) return;
    ref.current = handler;
    return () => {
      if (ref.current === handler) ref.current = undefined;
    };
  }, [ref, handler]);
}
