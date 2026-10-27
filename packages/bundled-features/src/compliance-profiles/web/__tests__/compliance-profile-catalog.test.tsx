import { describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ComplianceProfileCatalog } from "../compliance-profile-catalog.tsx";

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useQuery: mock(() => ({
    data: {
      profiles: [
        { key: "eu-dsgvo", region: "EU", label: "EU — GDPR standard", authorityContact: "BlnBDI" },
        { key: "minimal", region: "-", label: "Minimal", authorityContact: "" },
      ],
    },
    loading: false,
    error: null,
    refetch: mock(),
  })),
});

const germanBundle = {
  de: {
    "compliance-profiles:entity:__action-form__:field:profileKey:option:eu-dsgvo":
      "EU — DSGVO Standard",
  },
};

function GermanWrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de" })}
      fallbackBundles={[germanBundle]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("ComplianceProfileCatalog — profile names follow the locale", () => {
  test("a translated option label names the profile in the catalog", () => {
    render(<ComplianceProfileCatalog entityName="__action-form__" entityId={null} />, {
      wrapper: GermanWrapper,
    });
    expect(screen.getByText("EU — DSGVO Standard")).toBeTruthy();
  });

  test("a profile without an option translation keeps its source label", () => {
    render(<ComplianceProfileCatalog entityName="__action-form__" entityId={null} />, {
      wrapper: GermanWrapper,
    });
    expect(screen.getByText("Minimal")).toBeTruthy();
  });
});
