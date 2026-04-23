// NavTree rendert die Sidebar-Navigation aus den feature-deklarierten
// Nav-Einträgen. Eingabe: eine FeatureSchema (mit schema.navs flach
// deklariert), Ausgabe: gruppierter + sortierter + access-gefilterter
// Baum aus KumikoLinks.
//
// Die Qualifizierungs-Rule (`<feature>:nav:<id>`, `<feature>:screen:
// <id>`) wird hier client-seitig angewandt, konsistent zum server-
// seitigen Registry. Das Sample schreibt kurze ids in sein Schema;
// resolveNavigation erwartet qualifizierte ids und kriegt sie durch
// buildNavRegistrySlice.

import type { NavDefinition } from "@kumiko/framework/ui-types";
import type { NavNode, NavRegistrySlice } from "@kumiko/headless";
import { resolveNavigation } from "@kumiko/headless";
import type { FeatureSchema } from "@kumiko/renderer";
import { useNav, useTokens } from "@kumiko/renderer";
import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { KumikoLink } from "../app/nav";

export type NavTreeProps = {
  readonly schema: FeatureSchema;
  /** Aktueller User fürs Access-Gating. Optional — wenn nicht gesetzt,
   *  sieht man nur openToAll-Einträge (das ist der "anonymous visit"
   *  Modus). Apps die einen Login haben, reichen hier den JWT-User
   *  durch. */
  readonly user?: { readonly id: string; readonly roles: readonly string[] };
  readonly testId?: string;
};

export function NavTree({ schema, user, testId }: NavTreeProps): ReactNode {
  const tree = useMemo(() => {
    const source = buildNavRegistrySlice(schema);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [schema, user]);
  return (
    <div data-testid={testId} data-kumiko-layout="nav-tree">
      {tree.map((node) => (
        <NavNodeItem key={node.qualifiedName} node={node} depth={0} />
      ))}
    </div>
  );
}

function NavNodeItem({
  node,
  depth,
}: {
  readonly node: NavNode;
  readonly depth: number;
}): ReactNode {
  const nav = useNav();
  const t = useTokens();

  // Active-State: der screen-qn im NavNode endet auf "<feature>:screen:
  // <id>"; der aktuelle useNav().route.screenId ist die unqualifizierte
  // short-id. Wir matchen auf Suffix nach dem letzten ":".
  const active = node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);

  const itemStyle: CSSProperties = {
    display: "block",
    padding: `${t.spacing.xs} ${t.spacing.sm}`,
    paddingLeft: `calc(${t.spacing.sm} + ${depth * 16}px)`,
    color: active ? t.color.text : t.color.textMuted,
    textDecoration: "none",
    fontSize: t.fontSize.body,
    fontWeight: active ? 600 : 400,
    background: active
      ? `color-mix(in srgb, ${t.color.primary.background} 12%, transparent)`
      : "transparent",
    borderRadius: t.radius.sm,
  };

  const groupStyle: CSSProperties = {
    display: "block",
    padding: `${t.spacing.xs} ${t.spacing.sm}`,
    paddingLeft: `calc(${t.spacing.sm} + ${depth * 16}px)`,
    color: t.color.textMuted,
    fontSize: t.fontSize.small,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  // Node mit screen → klickbarer Link. Node ohne screen → reine
  // Gruppe (Header), Kinder darunter eingerückt.
  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <>
        <KumikoLink to={{ screenId }} style={itemStyle}>
          {node.label}
        </KumikoLink>
        {node.children.length > 0 &&
          node.children.map((child) => (
            <NavNodeItem key={child.qualifiedName} node={child} depth={depth + 1} />
          ))}
      </>
    );
  }
  return (
    <>
      <div style={groupStyle}>{node.label}</div>
      {node.children.map((child) => (
        <NavNodeItem key={child.qualifiedName} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// Baut einen NavRegistrySlice aus einer flachen FeatureSchema.navs-
// Liste. Der server-side Registry speichert qualifizierte ids; hier
// dupliziert der Client diese Konvention.
//
// Exported weil Test + ggf. Custom-Nav-Consumer es brauchen; die
// NavTree-Component nutzt's intern und ist die normale Konsumenten-
// Seite.
export function buildNavRegistrySlice(schema: FeatureSchema): NavRegistrySlice {
  const qualified: NavDefinition[] = (schema.navs ?? []).map((n) => ({
    ...n,
    id: qualifyNavId(schema.featureName, n.id),
    ...(n.parent !== undefined && { parent: qualifyNavId(schema.featureName, n.parent) }),
    ...(n.screen !== undefined && { screen: qualifyScreenId(schema.featureName, n.screen) }),
  }));
  const topLevel: NavDefinition[] = [];
  const byParentMap = new Map<string, NavDefinition[]>();
  for (const nav of qualified) {
    if (nav.parent !== undefined) {
      const list = byParentMap.get(nav.parent) ?? [];
      list.push(nav);
      byParentMap.set(nav.parent, list);
    } else {
      topLevel.push(nav);
    }
  }
  return {
    topLevel,
    byParent: (parent) => byParentMap.get(parent) ?? [],
  };
}

// Wenn die id bereits qualifiziert ist (enthält ":nav:"), unverändert
// lassen; sonst qualifizieren. Das erlaubt dem Dev beides zu schreiben —
// kurze ids sind der Normalfall, qualifizierte sind explizit erlaubt
// für cross-feature-Parents.
function qualifyNavId(feature: string, id: string): string {
  return id.includes(":nav:") ? id : `${feature}:nav:${id}`;
}

function qualifyScreenId(feature: string, id: string): string {
  return id.includes(":screen:") ? id : `${feature}:screen:${id}`;
}

function lastSegment(qn: string): string {
  const idx = qn.lastIndexOf(":");
  return idx < 0 ? qn : qn.slice(idx + 1);
}
