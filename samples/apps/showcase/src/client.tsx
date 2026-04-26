// Browser-Entry. KEINE Auth — Auto-Mint-JWT-Mode (server.ts ohne
// `auth`-Block). Der Showcase ist eine UI-Primitive-Spielwiese.
//
// Custom-Screen-Routing: für `screen.type === "custom"` Screens (Demo-
// Pages) rendert KumikoScreen heute einen Placeholder-Banner. Der Shell
// hier wrapt das — wenn die aktive screenId zu einer Demo gehört,
// rendern wir die Demo-Component statt `children`. Saubere Pattern: kein
// Plumbing im Framework, das Sample owned seine eigenen Custom-Screens.

import { useNav } from "@kumiko/renderer";
import {
  type AppSchema,
  type ClientFeatureDefinition,
  createKumikoApp,
  DefaultAppShell,
  ThemeToggle,
} from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { BannerDemo, ButtonsDemo, InputsDemo, TextDemo } from "./demo-pages";

const appClientFeature: ClientFeatureDefinition = {
  name: "showcase",
  translations: {
    de: {
      "showcase:nav.list": "Items",
      "showcase:nav.new": "Neuer Eintrag",
      "showcase:entity:item:field:title": "Titel",
      "showcase:entity:item:field:priority": "Priorität",
      "showcase:entity:item:field:isDone": "Erledigt?",
      "showcase:entity:item:field:status": "Status",
      "showcase:entity:item:field:notes": "Notizen",
      "showcase:entity:item:field:dueDate": "Fällig am",
      // Screen-Titles für die Top-Action-Bar (RenderList/RenderEdit
      // resolven den i18n-Key `screen:<id>.title`).
      "screen:item-list.title": "Items",
      "screen:item-edit.title": "Eintrag bearbeiten",
      "screen:demo-buttons.title": "Buttons",
      "screen:demo-inputs.title": "Inputs",
      "screen:demo-banner.title": "Banner",
      "screen:demo-text.title": "Text",
    },
    en: {
      "showcase:nav.list": "Items",
      "showcase:nav.new": "New item",
      "showcase:entity:item:field:title": "Title",
      "showcase:entity:item:field:priority": "Priority",
      "showcase:entity:item:field:isDone": "Done?",
      "showcase:entity:item:field:status": "Status",
      "showcase:entity:item:field:notes": "Notes",
      "showcase:entity:item:field:dueDate": "Due date",
      "screen:item-list.title": "Items",
      "screen:item-edit.title": "Edit item",
      "screen:demo-buttons.title": "Buttons",
      "screen:demo-inputs.title": "Inputs",
      "screen:demo-banner.title": "Banner",
      "screen:demo-text.title": "Text",
    },
  },
};

const Brand = (): ReactNode => (
  <strong className="text-foreground tracking-tight">Kumiko Showcase</strong>
);

const SidebarActions = (): ReactNode => (
  <ThemeToggle
    lightIcon={<Sun className="h-4 w-4" />}
    darkIcon={<MoonStar className="h-4 w-4" />}
  />
);

// Mapping screenId → Demo-Component. Erweiterbar ohne den Switch-Block
// im Shell aufzubohren — wer eine neue Demo addet, registriert sie hier
// und im Schema (r.screen + r.nav) im feature.ts.
const DEMO_PAGES: Record<string, () => ReactNode> = {
  "demo-buttons": ButtonsDemo,
  "demo-inputs": InputsDemo,
  "demo-banner": BannerDemo,
  "demo-text": TextDemo,
};

const AppShell = ({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode => {
  const nav = useNav();
  const screenId = nav.route?.screenId;
  const DemoComponent = screenId !== undefined ? DEMO_PAGES[screenId] : undefined;

  return (
    <DefaultAppShell brand={<Brand />} schema={schema} sidebarActions={<SidebarActions />}>
      {DemoComponent !== undefined ? <DemoComponent /> : children}
    </DefaultAppShell>
  );
};

createKumikoApp({
  shell: AppShell,
  clientFeatures: [appClientFeature],
});
