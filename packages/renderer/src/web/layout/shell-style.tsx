import { createContext, useContext } from "react";

export type ShellNavStyle = "default" | "plain";

const ShellNavStyleContext = createContext<ShellNavStyle>("default");

export const ShellNavStyleProvider = ShellNavStyleContext.Provider;

export function useShellNavStyle(): ShellNavStyle {
  return useContext(ShellNavStyleContext);
}
