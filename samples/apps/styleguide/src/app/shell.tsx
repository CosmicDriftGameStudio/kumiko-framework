import { useNav } from "@cosmicdrift/kumiko-renderer";
import type { AppSchema } from "@cosmicdrift/kumiko-renderer-web";
import {
  DefaultAppShell,
  EditorPanel,
  parseTargetFromSearchParams,
  SidebarBrand,
  SidebarUser,
  useResolvers,
} from "@cosmicdrift/kumiko-renderer-web";
import { GalleryVerticalEnd } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({
  children,
  schema,
}: {
  children: ReactNode;
  schema: AppSchema;
}): ReactNode {
  // Content-Panel-Switch (= P4-Muster, hier demo-lokal): ist ein target in
  // der URL aktiv (Klick auf eine Content-Seite oder das „+"), füllt das
  // EditorPanel den Main-Bereich; sonst der normale Screen. „Nichts
  // selektiert" → children (kein „Screen not found"-Regress).
  const nav = useNav();
  const resolvers = useResolvers();
  const activeTarget = parseTargetFromSearchParams(nav.searchParams);
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
      {activeTarget !== undefined ? <EditorPanel resolvers={resolvers} /> : children}
    </DefaultAppShell>
  );
}
