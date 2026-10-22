import { type RefObject, useEffect, useRef } from "react";

export function useFocusOnMount(enabled: boolean | undefined): RefObject<HTMLInputElement | null> {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (enabled === true) ref.current?.focus();
  }, [enabled]);
  return ref;
}
