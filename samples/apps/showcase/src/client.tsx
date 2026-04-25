// Browser-Entry. KEINE Auth — Auto-Mint-JWT-Mode (server.ts ohne
// `auth`-Block). Der Showcase ist eine UI-Primitive-Spielwiese, nicht
// ein Auth-Demo. Topbar zeigt nur Brand + ThemeToggle.

import {
  type AppSchema,
  type ClientFeatureDefinition,
  createKumikoApp,
  DefaultAppShell,
  ThemeToggle,
} from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

// i18n-Bundles für Nav-Labels + Field-Labels. Ohne diese Bundles
// würden NavTree + EditViewModel die raw fallback-Keys rendern.
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
    },
  },
};

const Brand = (): ReactNode => (
  <strong className="text-foreground tracking-tight">Kumiko Showcase</strong>
);

const TopbarActions = (): ReactNode => (
  <div className="flex items-center gap-2">
    <ThemeToggle
      lightIcon={<Sun className="h-4 w-4" />}
      darkIcon={<MoonStar className="h-4 w-4" />}
    />
  </div>
);

const AppShell = ({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode => (
  <DefaultAppShell brand={<Brand />} schema={schema} topbarActions={<TopbarActions />}>
    {children}
  </DefaultAppShell>
);

createKumikoApp({
  shell: AppShell,
  clientFeatures: [appClientFeature],
});
