import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TENANT_I18N } from "../../i18n";
import { MemberStatusCell } from "../member-status-cell";

const fallbackBundles = [translationsByLocaleFromKeys(TENANT_I18N)];

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={fallbackBundles}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("MemberStatusCell", () => {
  test("translates a known status", () => {
    render(
      <Wrapper>
        <MemberStatusCell value="active" row={{ status: "active" }} column={{ field: "status" }} />
      </Wrapper>,
    );
    expect(screen.getByText("Active")).toBeTruthy();
  });

  test("falls back to the raw value for an unknown status", () => {
    render(
      <Wrapper>
        <MemberStatusCell
          value="app-custom"
          row={{ status: "app-custom" }}
          column={{ field: "status" }}
        />
      </Wrapper>,
    );
    expect(screen.getByText("app-custom")).toBeTruthy();
  });
});
