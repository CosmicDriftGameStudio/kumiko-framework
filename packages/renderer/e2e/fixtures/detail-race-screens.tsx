// Two detail-style screens that render their own h1 and ask the shell header to give up its
// title (bodyTitle), as projection details do. h1-race.spec.ts counts the h1s on the page.

import { type ReactNode, useEffect, useState } from "react";
import { useNav } from "../../src/index";
import { DefaultPageHeader } from "../../src/web/primitives/page-header";

export const DETAIL_RACE_A_SCREEN_ID = "detail-race-a";
export const DETAIL_RACE_B_SCREEN_ID = "detail-race-b";

function DetailRaceScreen({
  recordTitle,
  otherScreenId,
}: {
  readonly recordTitle: string;
  readonly otherScreenId: string;
}): ReactNode {
  const nav = useNav();
  const [loaded, setLoaded] = useState(false);
  // The record arrives after the shell has rendered its breadcrumb, as in a real detail screen.
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);
  if (!loaded) return null;
  return (
    <div style={{ padding: "1rem" }}>
      <DefaultPageHeader bodyTitle recordTitle={recordTitle} />
      <h1>{recordTitle}</h1>
      <button
        type="button"
        data-testid="detail-race-switch"
        onClick={() => nav.navigate({ screenId: otherScreenId })}
      >
        switch
      </button>
    </div>
  );
}

export function DetailRaceScreenA(): ReactNode {
  return (
    <DetailRaceScreen recordTitle="Wohnung in Leipzig" otherScreenId={DETAIL_RACE_B_SCREEN_ID} />
  );
}

export function DetailRaceScreenB(): ReactNode {
  return <DetailRaceScreen recordTitle="Haus in Dresden" otherScreenId={DETAIL_RACE_A_SCREEN_ID} />;
}
