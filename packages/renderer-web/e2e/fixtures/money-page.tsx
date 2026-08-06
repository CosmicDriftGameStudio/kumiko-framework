// Standalone mount page for MoneyInput (no createKumikoApp / AppSchema).
// Two fields in sequence to reproduce the Tab-chain case from
// framework#1856: focus swaps the display from formatted to editable, and
// on a real browser that collapses the cursor to the end of the new value
// instead of preserving position, so text typed right after arrives via
// Tab (or Playwright's `.fill()`) got appended instead of replacing.
//
// Output tracking like combobox-page.tsx: onChange writes to
// data-money-<id> so the spec can read it back without page.evaluate.

import { type ReactNode, useState } from "react";
import { MoneyInput } from "../../src/primitives/money-input";

function MoneyTestPage(): ReactNode {
  const [a, setA] = useState<number | "">(0);
  const [b, setB] = useState<number | "">(0);

  return (
    <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1>Money e2e</h1>
      <form>
        <section data-testid="section-money-a">
          <MoneyInput
            id="money-a"
            name="a"
            value={a}
            onChange={(v) => {
              const next = v ?? "";
              setA(next);
              document.body.setAttribute("data-money-a", String(next));
            }}
            currency="EUR"
            locale="de-DE"
          />
        </section>
        <section data-testid="section-money-b">
          <MoneyInput
            id="money-b"
            name="b"
            value={b}
            onChange={(v) => {
              const next = v ?? "";
              setB(next);
              document.body.setAttribute("data-money-b", String(next));
            }}
            currency="EUR"
            locale="de-DE"
          />
        </section>
      </form>
    </div>
  );
}

export { MoneyTestPage };
