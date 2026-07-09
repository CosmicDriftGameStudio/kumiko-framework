// Browser-Entry. runDevApp's clientEntry-Option bundlet diese Datei zu
// /client.js und das Default-HTML lädt sie. createKumikoApp liest das
// Schema aus dem window-globalen (das injectSchema im dev-server setzt)
// und mountet die Routen.
//
// DefaultAppShell liefert die Sidebar + Topbar — ohne `shell` rendert
// createKumikoApp das aktive Screen ohne Layout-Wrapper (= nach Login
// nur ein nackter Banner statt der App). emailPasswordClient() bringt
// Login-Screen + Session-Provider — ohne ihn bliebe /login leer.
//
// Neue Client-Plugins (z.B. notificationsClient()) hier in clientFeatures
// hinzu — symmetrisch zu APP_FEATURES auf der Server-Seite.

import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";

createKumikoApp({
  shell: DefaultAppShell,
  clientFeatures: [emailPasswordClient()],
});
