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
import { MemberRolesCell } from "../member-roles-cell";

const fallbackBundles = [translationsByLocaleFromKeys(TENANT_I18N)];

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={fallbackBundles}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("MemberRolesCell", () => {
  test("translates known roles, joined by comma", () => {
    render(
      <Wrapper>
        <MemberRolesCell
          value={["TenantAdmin", "Editor"]}
          row={{ roles: ["TenantAdmin", "Editor"] }}
          column={{ field: "roles" }}
        />
      </Wrapper>,
    );
    expect(screen.getByText("Tenant Admin, Editor")).toBeTruthy();
  });

  test("falls back to the raw name for an unknown, app-defined role", () => {
    render(
      <Wrapper>
        <MemberRolesCell
          value={["AppCustomRole"]}
          row={{ roles: ["AppCustomRole"] }}
          column={{ field: "roles" }}
        />
      </Wrapper>,
    );
    expect(screen.getByText("AppCustomRole")).toBeTruthy();
  });

  test("renders nothing for a non-array roles value", () => {
    render(
      <Wrapper>
        <MemberRolesCell value={undefined} row={{}} column={{ field: "roles" }} />
      </Wrapper>,
    );
    expect(screen.queryByText(/./)).toBeNull();
  });
});
