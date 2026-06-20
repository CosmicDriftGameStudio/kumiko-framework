import type { AppSchema } from "@cosmicdrift/kumiko-renderer-web";
import { DefaultAppShell, SidebarBrand, SidebarUser } from "@cosmicdrift/kumiko-renderer-web";
import { GalleryVerticalEnd } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({
  children,
  schema,
}: {
  children: ReactNode;
  schema: AppSchema;
}): ReactNode {
  return (
    <DefaultAppShell
      schema={schema}
      brand={
        <SidebarBrand
          name="Kumiko"
          plan="Styleguide"
          logo={<GalleryVerticalEnd className="size-4" />}
        />
      }
      sidebarFooter={<SidebarUser name="Marc Frost" email="marc@cosmicdrift.dev" />}
    >
      {children}
    </DefaultAppShell>
  );
}
