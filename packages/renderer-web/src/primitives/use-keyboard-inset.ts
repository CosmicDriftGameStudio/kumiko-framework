import { useEffect, useState } from "react";

function readKeyboardInset(): number {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) return 0;
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
}

// iOS Safari ignores `interactive-widget=resizes-content`: the layout viewport keeps its full
// height under the keyboard, so `fixed bottom-0` bars sit behind it. Where the key is honoured
// (Chromium/Android) the layout viewport shrinks too, the difference is 0 and nothing shifts.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null || viewport === undefined) return;
    const update = (): void => setInset(readKeyboardInset());
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
