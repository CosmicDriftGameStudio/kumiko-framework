import { createContext, useContext } from "react";

// True while a form renders inside the Drawer primitive (DrawerHost). The form
// then drops its own title and card chrome (the drawer header carries the
// title) and lays out as scrolling body plus pinned footer.
const InsideDrawerContext = createContext(false);

export const InsideDrawerProvider = InsideDrawerContext.Provider;

export function useInsideDrawer(): boolean {
  return useContext(InsideDrawerContext);
}
