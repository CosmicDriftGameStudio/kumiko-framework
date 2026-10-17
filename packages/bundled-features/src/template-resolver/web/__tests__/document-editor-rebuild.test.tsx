import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect, useState } from "react";
import DocumentTiptapEditor from "../document-tiptap-editor.js";
import { defaultTranslations } from "../i18n.js";

const localeResolver = createStaticLocaleResolver({ locale: "en" });
const LOADED_SYSTEM_VARIABLES = ["imprint", "tenantName"];
const LOADED_VALUE = "<p>Nordlicht Immobilien GmbH</p>";

// The layout editor mounts the region editors before its validate query returns the system
// placeholders. Those rebuild the tiptap editor (new extensions) in the same commit in which
// the controlled value moves on, which used to read the just-destroyed editor.
function LateQueryResult(): ReactNode {
  const [systemVariables, setSystemVariables] = useState<readonly string[]>([]);
  const [value, setValue] = useState("<p>Draft</p>");
  useEffect(() => {
    setSystemVariables(LOADED_SYSTEM_VARIABLES);
    setValue(LOADED_VALUE);
  }, []);
  return (
    <LocaleProvider
      resolver={localeResolver}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>
        <DocumentTiptapEditor
          id="region-footer"
          value={value}
          onChange={setValue}
          variables={systemVariables}
          systemVariables={systemVariables}
          readOnly={false}
        />
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("DocumentTiptapEditor rebuild", () => {
  test("system placeholders arriving with a new value rebuild the editor without a crash", async () => {
    render(<LateQueryResult />);
    await waitFor(() => {
      const editable = document.querySelector("#region-footer");
      expect(editable?.textContent).toBe("Nordlicht Immobilien GmbH");
    });
    expect(screen.getByRole("button", { name: "Bold" })).toBeDefined();
  });
});
