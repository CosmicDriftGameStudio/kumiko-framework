import { afterEach, describe, expect, test } from "bun:test";
import { managedPagesClient } from "@cosmicdrift/kumiko-bundled-features/managed-pages/web";
import {
  ContentPreviewsProvider,
  PreviewPane,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { cleanup, render, screen } from "@testing-library/react";
import { brandedPreviewClient } from "../web/branded-preview.tsx";

afterEach(cleanup);

describe("custom preview renderer", () => {
  test("the app's renderer replaces the managed-pages web preview for the same target", () => {
    expect(managedPagesClient().contentPreviews?.web).toBeDefined();
    expect(brandedPreviewClient().contentPreviews?.web).not.toBe(
      managedPagesClient().contentPreviews?.web,
    );
  });

  test("the workbench shows the draft body in the app's own frame", () => {
    render(
      <ContentPreviewsProvider value={brandedPreviewClient().contentPreviews ?? {}}>
        <PreviewPane
          target="web"
          content="Opening hours: 8 to 18"
          editFormat="plain"
          variables={{}}
          subject={{ kind: "body" }}
        />
      </ContentPreviewsProvider>,
    );
    expect(screen.getByTestId("branded-preview-body").textContent).toBe("Opening hours: 8 to 18");
  });

  test("a target the app registered no renderer for still previews as text", () => {
    render(
      <PrimitivesProvider value={defaultPrimitives}>
        <ContentPreviewsProvider value={brandedPreviewClient().contentPreviews ?? {}}>
          <PreviewPane
            target="mail"
            content="Mail words"
            editFormat="plain"
            variables={{}}
            subject={{ kind: "body" }}
          />
        </ContentPreviewsProvider>
      </PrimitivesProvider>,
    );
    expect(screen.queryByTestId("branded-preview")).toBeNull();
    expect(screen.getByDisplayValue("Mail words")).toBeDefined();
  });
});
