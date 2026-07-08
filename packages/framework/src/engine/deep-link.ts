// Deep-Link-URL-Builder für Notification-Templates (#449, Lazy-Scope: nur
// Notification→Screen, kein Permalink-Sharing-Layer). Server-seitig nutzbar
// (kein React) — der Renderer hat mit `formatPath`
// (packages/renderer/src/app/nav.tsx) dasselbe Pfad-Format fürs Client-Routing,
// hier bewusst dupliziert statt importiert: `renderer` zieht React als
// Dependency, Notification-Data-Fns laufen server-seitig im Write-Handler.
//
// baseUrl kommt vom App-Autor (analog `AuthMailOptions.baseUrl` /
// magic-link-mail.ts appendToken) — kein Auto-Detect, kein Env-Var-Read hier.

export type DeepLinkTarget = {
  readonly screenId: string;
  readonly entityId?: string;
  readonly workspaceId?: string;
};

export function buildDeepLinkUrl(baseUrl: string, target: DeepLinkTarget): string {
  const segments: string[] = [];
  if (target.workspaceId !== undefined) segments.push(target.workspaceId);
  segments.push(target.screenId);
  if (target.entityId !== undefined) segments.push(target.entityId);
  return `${baseUrl.replace(/\/+$/, "")}/${segments.join("/")}`;
}
