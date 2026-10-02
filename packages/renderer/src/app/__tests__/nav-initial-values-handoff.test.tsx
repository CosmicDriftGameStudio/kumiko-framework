// The in-memory initial-values handoff: an offer is consumed exactly once by
// the form that mounts for the target screen, and an offer whose form never
// mounted must not resurface on a later, unrelated visit.

import { describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import {
  type NavApi,
  NavProvider,
  type NavTarget,
  useInitialValuesHandoff,
  useNavigateWithInitialValues,
} from "../nav.js";

type Harness = {
  readonly mounts: Array<{ readonly label: string; readonly values: unknown }>;
  offer: (values: Readonly<Record<string, unknown>>) => void;
  go: (screenId: string) => void;
  showSecondForm: () => void;
};

function mountHarness(initialScreenId: string): Harness {
  const harness: Harness = {
    mounts: [],
    offer: () => {},
    go: () => {},
    showSecondForm: () => {},
  };

  function Opener(): ReactNode {
    const navigateWithInitialValues = useNavigateWithInitialValues();
    harness.offer = (values) => navigateWithInitialValues({ screenId: "unit-edit" }, values);
    return null;
  }

  function Form({ label }: { readonly label: string }): ReactNode {
    const values = useInitialValuesHandoff("unit-edit");
    useState(() => {
      harness.mounts.push({ label, values });
      return null;
    });
    return null;
  }

  function App(): ReactNode {
    const [screenId, setScreenId] = useState(initialScreenId);
    const [second, setSecond] = useState(false);
    harness.go = setScreenId;
    harness.showSecondForm = () => setSecond(true);
    const nav: NavApi = {
      route: { screenId },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) setScreenId(target.screenId);
      },
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };
    return (
      <NavProvider value={nav}>
        <Opener />
        {screenId === "unit-edit" && <Form label="first" />}
        {screenId === "unit-edit" && second && <Form label="second" />}
      </NavProvider>
    );
  }

  render(<App />);
  return harness;
}

describe("initial-values handoff", () => {
  test("an offer is consumed once: the mounting form gets it, a later mount of the same screen does not", () => {
    const harness = mountHarness("home");

    act(() => harness.offer({ iban: "DE12" }));
    expect(harness.mounts).toEqual([{ label: "first", values: { iban: "DE12" } }]);

    act(() => harness.showSecondForm());
    expect(harness.mounts[1]).toEqual({ label: "second", values: undefined });
  });

  test("an offer to the already-open screen is dropped once the route moves on and never resurfaces", () => {
    const harness = mountHarness("unit-edit");
    expect(harness.mounts).toEqual([{ label: "first", values: undefined }]);

    // The target form is already mounted, so nothing consumes the offer.
    act(() => harness.offer({ iban: "DE12" }));
    expect(harness.mounts).toHaveLength(1);

    act(() => harness.go("home"));
    act(() => harness.go("unit-edit"));

    expect(harness.mounts).toEqual([
      { label: "first", values: undefined },
      { label: "first", values: undefined },
    ]);
  });
});
