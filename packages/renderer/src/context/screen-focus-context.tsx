import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

/** The record an open screen is about, reported for consumers such as assistants. */
export type ScreenFocus = {
  readonly entityName: string;
  readonly recordId: string;
  readonly label: string;
  readonly facts?: Readonly<Record<string, string>>;
};

type SetScreenFocus = (focus: ScreenFocus | null) => void;

const ScreenFocusContext = createContext<ScreenFocus | null>(null);
const noopSetScreenFocus: SetScreenFocus = () => {};
const SetScreenFocusContext = createContext<SetScreenFocus>(noopSetScreenFocus);

export function ScreenFocusProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [focus, setFocus] = useState<ScreenFocus | null>(null);
  return (
    <SetScreenFocusContext value={setFocus}>
      <ScreenFocusContext value={focus}>{children}</ScreenFocusContext>
    </SetScreenFocusContext>
  );
}

export function useScreenFocus(): ScreenFocus | null {
  return useContext(ScreenFocusContext);
}

/** Reports the focus while the calling screen is mounted; compared by value, cleared on unmount. */
export function useSetScreenFocus(focus: ScreenFocus | null): void {
  const setFocus = useContext(SetScreenFocusContext);
  const key = focus === null ? null : JSON.stringify(focus);
  const lastReported = useRef<{ readonly key: string | null; readonly focus: ScreenFocus | null }>({
    key,
    focus,
  });
  if (lastReported.current.key !== key) lastReported.current = { key, focus };
  const stableFocus = lastReported.current.focus;
  useEffect(() => {
    setFocus(stableFocus);
    return () => setFocus(null);
  }, [setFocus, stableFocus]);
}
