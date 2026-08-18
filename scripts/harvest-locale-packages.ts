#!/usr/bin/env bun
/**
 * One-shot: harvest de/es UI strings into locale packages, then strip them
 * from framework sources so core is en-only. Re-run after adding a language
 * to origin/main if you need to re-harvest; committed output is the source
 * of truth afterwards.
 */
import { $ } from "bun";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

const MAIL_DE: Record<string, string> = {
  "auth.mail.appNameDefault": "Konto",
  "auth.mail.reset.subject": "{app} — Passwort zurücksetzen",
  "auth.mail.reset.greeting": "Hallo,",
  "auth.mail.reset.intro":
    "du hast den Reset deines Passworts für {app} angefordert. Klicke auf den folgenden Link, um ein neues Passwort zu setzen:",
  "auth.mail.reset.button": "Passwort zurücksetzen",
  "auth.mail.reset.expiry": "Der Link läuft am {when} ab.",
  "auth.mail.reset.ignore":
    "Falls du keinen Reset angefordert hast, kannst du diese E-Mail einfach ignorieren — dein Passwort bleibt unverändert.",
  "auth.mail.verify.subject": "{app} — E-Mail bestätigen",
  "auth.mail.verify.greeting": "Willkommen,",
  "auth.mail.verify.intro":
    "bitte bestätige deine E-Mail-Adresse für {app}, um dein Konto zu aktivieren:",
  "auth.mail.verify.button": "E-Mail bestätigen",
  "auth.mail.verify.expiry": "Der Link läuft am {when} ab.",
  "auth.mail.verify.ignore":
    "Falls du dieses Konto nicht angelegt hast, kannst du diese E-Mail ignorieren.",
  "auth.mail.activation.subject": "{app} — Account aktivieren",
  "auth.mail.activation.greeting": "Willkommen,",
  "auth.mail.activation.intro":
    "klicke auf den folgenden Link, um deinen {app}-Account zu aktivieren. Im nächsten Schritt setzt du dein Passwort:",
  "auth.mail.activation.button": "Account aktivieren",
  "auth.mail.activation.expiry": "Der Link läuft am {when} ab.",
  "auth.mail.activation.ignore":
    "Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren — es wird kein Account erstellt, solange du den Link nicht öffnest.",
  "auth.mail.invite.subject": "{app} — Einladung zum Workspace",
  "auth.mail.invite.greeting": "Hallo,",
  "auth.mail.invite.intro":
    "du wurdest zu einem {app}-Workspace als {role} eingeladen. Klicke auf den folgenden Link, um die Einladung anzunehmen:",
  "auth.mail.invite.button": "Einladung annehmen",
  "auth.mail.invite.expiry": "Der Link läuft am {when} ab.",
  "auth.mail.invite.ignore":
    "Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
  "auth.mail.unlock.subject": "{app} — Konto entsperren",
  "auth.mail.unlock.greeting": "Hallo,",
  "auth.mail.unlock.intro":
    "dein {app}-Konto wurde nach mehreren fehlgeschlagenen Anmeldeversuchen vorübergehend gesperrt. Klicke auf den folgenden Link, um es sofort zu entsperren:",
  "auth.mail.unlock.button": "Konto entsperren",
  "auth.mail.unlock.expiry": "Der Link läuft am {when} ab.",
  "auth.mail.unlock.ignore":
    "Falls du diese Sperre nicht ausgelöst hast, kannst du diese E-Mail ignorieren — die Sperre läuft von selbst ab.",
  "gdpr.mail.appNameDefault": "Konto",
  "gdpr.mail.greeting": "Hallo,",
  "gdpr.mail.exportReady.subject": "{app} — Dein Datenexport ist bereit",
  "gdpr.mail.exportReady.intro":
    "dein angeforderter Datenexport fuer {app} ist fertig. Lade ihn ueber den folgenden Link herunter:",
  "gdpr.mail.exportReady.button": "Datenexport herunterladen",
  "gdpr.mail.exportReady.expiry": "Der Download-Link laeuft am {when} ab.",
  "gdpr.mail.exportFailed.subject": "{app} — Dein Datenexport ist fehlgeschlagen",
  "gdpr.mail.exportFailed.intro":
    "dein angeforderter Datenexport fuer {app} konnte leider nicht erstellt werden. Bitte fordere den Export erneut an.",
  "gdpr.mail.deletionRequested.subject": "{app} — Loeschung deines Kontos angefordert",
  "gdpr.mail.deletionRequested.intro":
    "wir haben deinen Antrag zur Loeschung deines {app}-Kontos erhalten. Dein Konto und die zugehoerigen Daten werden am {when} endgueltig geloescht.",
  "gdpr.mail.deletionRequested.cancel":
    "Falls du das nicht angefordert hast, melde dich an und brich die Loeschung in den Kontoeinstellungen ab, bevor die Frist ablaeuft.",
  "gdpr.mail.deletionExecuted.subject": "{app} — Dein Konto wurde geloescht",
  "gdpr.mail.deletionExecuted.intro":
    "dein {app}-Konto und die zugehoerigen personenbezogenen Daten wurden am {when} geloescht. Diese Aktion ist endgueltig.",
  "gdpr.mail.fallbackUrl": "Falls der Button nicht funktioniert, kopiere diesen Link in den Browser:",
};

const MAIL_ES: Record<string, string> = {
  "auth.mail.appNameDefault": "Cuenta",
  "auth.mail.reset.subject": "{app} — Restablecer contraseña",
  "auth.mail.reset.greeting": "Hola,",
  "auth.mail.reset.intro":
    "has solicitado restablecer la contraseña de {app}. Haz clic en el siguiente enlace para establecer una nueva:",
  "auth.mail.reset.button": "Restablecer contraseña",
  "auth.mail.reset.expiry": "El enlace caduca el {when}.",
  "auth.mail.reset.ignore":
    "Si no has solicitado un restablecimiento, puedes ignorar este correo — tu contraseña no cambiará.",
  "auth.mail.verify.subject": "{app} — Confirma tu correo",
  "auth.mail.verify.greeting": "Bienvenido,",
  "auth.mail.verify.intro":
    "confirma tu dirección de correo para {app} y activa tu cuenta:",
  "auth.mail.verify.button": "Confirmar correo",
  "auth.mail.verify.expiry": "El enlace caduca el {when}.",
  "auth.mail.verify.ignore": "Si no has creado esta cuenta, puedes ignorar este correo.",
  "auth.mail.activation.subject": "{app} — Activa tu cuenta",
  "auth.mail.activation.greeting": "Bienvenido,",
  "auth.mail.activation.intro":
    "haz clic en el siguiente enlace para activar tu cuenta de {app}. El siguiente paso es elegir tu contraseña:",
  "auth.mail.activation.button": "Activar cuenta",
  "auth.mail.activation.expiry": "El enlace caduca el {when}.",
  "auth.mail.activation.ignore":
    "Si no te has registrado, puedes ignorar este correo — no se crea ninguna cuenta hasta que abras el enlace.",
  "auth.mail.invite.subject": "{app} — Invitación al espacio de trabajo",
  "auth.mail.invite.greeting": "Hola,",
  "auth.mail.invite.intro":
    "te han invitado a un espacio de trabajo de {app} como {role}. Haz clic en el siguiente enlace para aceptar:",
  "auth.mail.invite.button": "Aceptar invitación",
  "auth.mail.invite.expiry": "El enlace caduca el {when}.",
  "auth.mail.invite.ignore": "Si no esperabas esta invitación, puedes ignorar este correo.",
  "auth.mail.unlock.subject": "{app} — Desbloquear cuenta",
  "auth.mail.unlock.greeting": "Hola,",
  "auth.mail.unlock.intro":
    "tu cuenta de {app} se bloqueó temporalmente tras varios inicios de sesión fallidos. Haz clic en el siguiente enlace para desbloquearla de inmediato:",
  "auth.mail.unlock.button": "Desbloquear cuenta",
  "auth.mail.unlock.expiry": "El enlace caduca el {when}.",
  "auth.mail.unlock.ignore":
    "Si no has provocado este bloqueo, puedes ignorar este correo — el bloqueo caduca por sí solo.",
  "gdpr.mail.appNameDefault": "Cuenta",
  "gdpr.mail.greeting": "Hola,",
  "gdpr.mail.exportReady.subject": "{app} — Tu exportación de datos está lista",
  "gdpr.mail.exportReady.intro":
    "la exportación de datos que solicitaste para {app} está lista. Descárgala con el siguiente enlace:",
  "gdpr.mail.exportReady.button": "Descargar exportación",
  "gdpr.mail.exportReady.expiry": "El enlace de descarga caduca el {when}.",
  "gdpr.mail.exportFailed.subject": "{app} — Tu exportación de datos ha fallado",
  "gdpr.mail.exportFailed.intro":
    "no se ha podido crear la exportación de datos de {app}. Vuelve a solicitarla.",
  "gdpr.mail.deletionRequested.subject": "{app} — Eliminación de cuenta solicitada",
  "gdpr.mail.deletionRequested.intro":
    "hemos recibido tu solicitud para eliminar tu cuenta de {app}. Tu cuenta y los datos asociados se eliminarán de forma permanente el {when}.",
  "gdpr.mail.deletionRequested.cancel":
    "Si no has solicitado esto, inicia sesión y cancela la eliminación en la configuración de la cuenta antes de que venza el plazo.",
  "gdpr.mail.deletionExecuted.subject": "{app} — Tu cuenta ha sido eliminada",
  "gdpr.mail.deletionExecuted.intro":
    "tu cuenta de {app} y los datos personales asociados se eliminaron el {when}. Esta acción es definitiva.",
  "gdpr.mail.fallbackUrl":
    "Si el botón no funciona, copia este enlace en el navegador:",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") {
      continue;
    }
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function skipQuote(src: string, i: number): number {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return i + 1;
  i++;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

function readString(src: string, i: number): { value: string; end: number } | null {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let value = "";
  i++;
  while (i < src.length) {
    if (src[i] === "\\") {
      const n = src[i + 1];
      if (n === "n") value += "\n";
      else if (n === "t") value += "\t";
      else if (n === "r") value += "\r";
      else value += n ?? "";
      i += 2;
      continue;
    }
    if (src[i] === q) return { value, end: i + 1 };
    value += src[i];
    i++;
  }
  return null;
}

function skipWsAndComments(src: string, i: number): number {
  while (i < src.length) {
    if (src[i] === " " || src[i] === "\t" || src[i] === "\n" || src[i] === "\r") {
      i++;
      continue;
    }
    if (src.startsWith("//", i)) {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function extractLocaleFirst(src: string, locale: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`(?:^|[\\n,{])\\s*${locale}\\s*:\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const brace = m.index + m[0].lastIndexOf("{");
    if (brace < 0 || src[brace] !== "{") continue;
    // Skip key-first inner objects (`"key": { de: "x" }`) — those have de: "string" not de: {
    // We already matched de: { so this is a block. Nested de:{ is rare; take the first
    // reasonably large block (more than 2 keys).
    const inner = extractObjectStrings(src, brace);
    Object.assign(out, inner);
  }
  return out;
}

function extractObjectStrings(src: string, openBrace: number): Record<string, string> {
  const out: Record<string, string> = {};
  let i = openBrace + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    i = skipWsAndComments(src, i);
    if (i >= src.length) break;
    if (src[i] === "}") {
      depth--;
      i++;
      continue;
    }
    if (src[i] === "{") {
      depth++;
      i++;
      continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const key = readString(src, i);
      if (!key) break;
      i = skipWsAndComments(src, key.end);
      if (src[i] !== ":") {
        i = key.end;
        continue;
      }
      i = skipWsAndComments(src, i + 1);
      if (src[i] === '"' || src[i] === "'") {
        const val = readString(src, i);
        if (val) {
          out[key.value] = val.value;
          i = val.end;
        }
      } else if (src[i] === "{") {
        depth++;
        i++;
      } else {
        i++;
      }
      continue;
    }
    i++;
  }
  return out;
}

function extractKeyFirstLocale(src: string, locale: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /"([^"\\]+)"\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const key = m[1];
    if (!key) continue;
    const brace = m.index + m[0].lastIndexOf("{");
    const props = extractLocaleProps(src, brace);
    const val = props[locale];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

function extractLocaleProps(src: string, openBrace: number): Record<string, string> {
  const out: Record<string, string> = {};
  let i = openBrace + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    i = skipWsAndComments(src, i);
    if (i >= src.length) break;
    if (src[i] === "{") {
      depth++;
      i++;
      continue;
    }
    if (src[i] === "}") {
      depth--;
      i++;
      continue;
    }
    const id = src.slice(i).match(/^(de|en|es)\s*:/);
    if (id && depth === 1) {
      i = skipWsAndComments(src, i + id[0].length);
      const val = readString(src, i);
      if (val) {
        out[id[1] ?? ""] = val.value;
        i = val.end;
      }
      continue;
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      i = skipQuote(src, i);
      continue;
    }
    i++;
  }
  return out;
}

function harvestFromSource(src: string, locale: string): Record<string, string> {
  // Pivot files (LOCALES.map) still carry extra locale-first tables (UDR apex).
  return { ...extractKeyFirstLocale(src, locale), ...extractLocaleFirst(src, locale) };
}

function i18nFiles(): string[] {
  return walk(join(ROOT, "packages")).filter(
    (p) =>
      (p.endsWith("/i18n.ts") || p.endsWith("/i18n-defaults.ts")) &&
      !p.includes("/__tests__/") &&
      !p.includes("/node_modules/"),
  );
}

async function harvestFromGit(ref: string, locale: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of i18nFiles()) {
    const rel = relative(ROOT, file);
    const proc = await $`git -C ${ROOT} show ${`${ref}:${rel}`}`.quiet().nothrow();
    if (proc.exitCode !== 0) continue;
    Object.assign(out, harvestFromSource(proc.stdout.toString(), locale));
  }
  return out;
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

function renderBundle(name: string, locale: string, bundle: Record<string, string>): string {
  const keys = Object.keys(bundle).sort();
  const lines = keys.map((k) => `  ${tsString(k)}: ${tsString(bundle[k] ?? "")},`);
  return `// Auto-harvested ${locale} copy for framework UI + mail. Do not edit by hand
// unless you are fixing a translation; add new English keys in the framework
// and extend this table (completeness test will fail otherwise).

export const ${name}: Readonly<Record<string, string>> = {
${lines.join("\n")}
};
`;
}

function stripKeyFirst(src: string): string {
  // Drop de/es properties inside { de, en, es } objects. Keep en.
  return src.replace(
    typeLocalizedRe,
    "type LocalizedString = { readonly en: string }",
  );
}

const typeLocalizedRe =
  /type LocalizedString = \{[^}]*readonly en: string[^}]*\}/g;

function stripLocaleBlocks(src: string): string {
  let out = src;
  for (const loc of ["de", "es"] as const) {
    const re = new RegExp(`(?:^|\\n)([ \\t]*)${loc}\\s*:\\s*\\{`, "g");
    let m: RegExpExecArray | null;
    const cuts: Array<{ start: number; end: number }> = [];
    while ((m = re.exec(out))) {
      const start = m.index + (out[m.index] === "\n" ? 1 : 0);
      const brace = out.indexOf("{", m.index);
      if (brace < 0) continue;
      // Only strip top-level locale-first blocks: the brace body should
      // contain quoted keys, not `en:` / `de:` nested LocalizedString.
      const preview = out.slice(brace, brace + 80);
      if (/^\{\s*(de|en|es)\s*:/.test(preview)) continue;
      let i = brace;
      let depth = 0;
      while (i < out.length) {
        if (out[i] === '"' || out[i] === "'" || out[i] === "`") {
          i = skipQuote(out, i);
          continue;
        }
        if (out[i] === "{") depth++;
        else if (out[i] === "}") {
          depth--;
          if (depth === 0) {
            let end = i + 1;
            if (out[end] === ",") end++;
            cuts.push({ start, end });
            break;
          }
        }
        i++;
      }
    }
    for (const cut of cuts.reverse()) {
      out = out.slice(0, cut.start) + out.slice(cut.end);
    }
  }
  return out;
}

function stripDeEsProps(src: string): string {
  // Remove `de: "...",` and `es: "...",` (and multiline) inside objects.
  let i = 0;
  let out = "";
  while (i < src.length) {
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const start = i;
      i = skipQuote(src, i);
      out += src.slice(start, i);
      continue;
    }
    const rest = src.slice(i);
    const prop = rest.match(/^(de|es)\s*:/);
    if (prop) {
      let j = skipWsAndComments(src, i + prop[0].length);
      if (src[j] === '"' || src[j] === "'" || src[j] === "`") {
        j = skipQuote(src, j);
        j = skipWsAndComments(src, j);
        if (src[j] === ",") j++;
        i = j;
        continue;
      }
    }
    out += src[i];
    i++;
  }
  return out;
}

const PIVOT = `import { translationsByLocaleFromKeys, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
`;

function rewritePivot(src: string): string | null {
  if (!/const LOCALES = /.test(src) || !/LOCALES\.map/.test(src)) return null;
  const ident = src.match(/import \{ (\w+) \} from "\.\.\/i18n"/);
  if (!ident?.[1]) return null;
  const header = src.split("import type { TranslationsByLocale }")[0] ?? "";
  return `${header}${PIVOT}import { ${ident[1]} } from "../i18n";

export const defaultTranslations: TranslationsByLocale = translationsByLocaleFromKeys(${ident[1]});
`;
}

const MAIL_EN: Record<string, string> = {
  "auth.mail.appNameDefault": "Account",
  "auth.mail.reset.subject": "{app} — Reset your password",
  "auth.mail.reset.greeting": "Hi,",
  "auth.mail.reset.intro":
    "you requested a password reset for {app}. Click the link below to set a new password:",
  "auth.mail.reset.button": "Reset password",
  "auth.mail.reset.expiry": "The link expires on {when}.",
  "auth.mail.reset.ignore":
    "If you didn't request a reset, you can safely ignore this email — your password won't change.",
  "auth.mail.verify.subject": "{app} — Verify your email",
  "auth.mail.verify.greeting": "Welcome,",
  "auth.mail.verify.intro":
    "please verify your email address for {app} to activate your account:",
  "auth.mail.verify.button": "Verify email",
  "auth.mail.verify.expiry": "The link expires on {when}.",
  "auth.mail.verify.ignore": "If you didn't create this account, you can ignore this email.",
  "auth.mail.activation.subject": "{app} — Activate your account",
  "auth.mail.activation.greeting": "Welcome,",
  "auth.mail.activation.intro":
    "click the link below to activate your {app} account. The next step is choosing your password:",
  "auth.mail.activation.button": "Activate account",
  "auth.mail.activation.expiry": "The link expires on {when}.",
  "auth.mail.activation.ignore":
    "If you didn't sign up, you can ignore this email — no account is created until you open the link.",
  "auth.mail.invite.subject": "{app} — Workspace invitation",
  "auth.mail.invite.greeting": "Hi,",
  "auth.mail.invite.intro":
    "you've been invited to a {app} workspace as {role}. Click the link below to accept:",
  "auth.mail.invite.button": "Accept invitation",
  "auth.mail.invite.expiry": "The link expires on {when}.",
  "auth.mail.invite.ignore": "If you weren't expecting this invitation, you can ignore this email.",
  "auth.mail.unlock.subject": "{app} — Unlock your account",
  "auth.mail.unlock.greeting": "Hi,",
  "auth.mail.unlock.intro":
    "your {app} account was temporarily locked after several failed sign-in attempts. Click the link below to unlock it immediately:",
  "auth.mail.unlock.button": "Unlock account",
  "auth.mail.unlock.expiry": "The link expires on {when}.",
  "auth.mail.unlock.ignore":
    "If you didn't trigger this lock, you can ignore this email — the lock expires on its own.",
  "gdpr.mail.appNameDefault": "Account",
  "gdpr.mail.greeting": "Hi,",
  "gdpr.mail.exportReady.subject": "{app} — Your data export is ready",
  "gdpr.mail.exportReady.intro":
    "your requested data export for {app} is ready. Download it using the link below:",
  "gdpr.mail.exportReady.button": "Download data export",
  "gdpr.mail.exportReady.expiry": "The download link expires on {when}.",
  "gdpr.mail.exportFailed.subject": "{app} — Your data export failed",
  "gdpr.mail.exportFailed.intro":
    "your requested data export for {app} could not be created. Please request the export again.",
  "gdpr.mail.deletionRequested.subject": "{app} — Account deletion requested",
  "gdpr.mail.deletionRequested.intro":
    "we received your request to delete your {app} account. Your account and associated data will be permanently deleted on {when}.",
  "gdpr.mail.deletionRequested.cancel":
    "If you didn't request this, sign in and cancel the deletion in your account settings before the deadline.",
  "gdpr.mail.deletionExecuted.subject": "{app} — Your account has been deleted",
  "gdpr.mail.deletionExecuted.intro":
    "your {app} account and the associated personal data were deleted on {when}. This action is permanent.",
  "gdpr.mail.fallbackUrl":
    "If the button doesn't work, copy this link into your browser:",
};

async function main() {
  const stringsOnly = process.argv.includes("--strings-only");
  const de: Record<string, string> = { ...MAIL_DE };
  const es: Record<string, string> = { ...MAIL_ES };
  const enCatalog: Record<string, string> = { ...MAIL_EN };
  // Working tree is en-only after strip — German must come from last commit.
  Object.assign(de, await harvestFromGit("HEAD", "de"));
  for (const file of i18nFiles()) {
    Object.assign(enCatalog, harvestFromSource(readFileSync(file, "utf8"), "en"));
  }
  Object.assign(es, await harvestFromGit("origin/main", "es"));
  // These four keys shipped EN-only in the UDR apex table (no de/es sibling).
  Object.assign(de, {
    "userDataRights.errors.download.notFound":
      "Der Download-Link ist ungültig oder gehört zu einem anderen Konto.",
    "userDataRights.errors.download.expired":
      "Dein Download ist abgelaufen. Bitte fordere einen neuen Export an.",
    "userDataRights.errors.download.unavailable":
      "Der Export ist noch nicht fertig oder fehlgeschlagen. Bitte prüfe den Status.",
    "userDataRights.errors.download.signedUrlNotSupported":
      "Der Download ist wegen eines Server-Konfigurationsproblems derzeit nicht verfügbar. Der Betreiber wurde benachrichtigt.",
    "auth.inviteAccept.loggedInAs":
      "Du bist als {email} eingeloggt — klicke 'Annehmen' um Mitglied zu werden.",
  });
  Object.assign(es, {
    "userDataRights.errors.download.notFound":
      "El enlace de descarga no es válido o pertenece a otra cuenta.",
    "userDataRights.errors.download.expired":
      "Tu descarga ha caducado. Solicita una nueva exportación.",
    "userDataRights.errors.download.unavailable":
      "La exportación aún no está lista o ha fallado. Comprueba el estado.",
    "userDataRights.errors.download.signedUrlNotSupported":
      "La descarga no está disponible por un problema de configuración del servidor. Se ha notificado al operador.",
    "auth.inviteAccept.loggedInAs":
      "Has iniciado sesión como {email} — haz clic en 'Aceptar' para unirte.",
  });

  console.log(`harvest de=${Object.keys(de).length} es=${Object.keys(es).length} en=${Object.keys(enCatalog).length}`);

  writeFileSync(join(ROOT, "packages/locale-de/src/strings.ts"), renderBundle("localeDeBundle", "de", de));
  writeFileSync(join(ROOT, "packages/locale-es/src/strings.ts"), renderBundle("localeEsBundle", "es", es));
  const enCatalogSrc = renderBundle("frameworkEnCatalog", "en", enCatalog);
  writeFileSync(join(ROOT, "packages/locale-de/src/__tests__/en-catalog.ts"), enCatalogSrc);
  writeFileSync(join(ROOT, "packages/locale-es/src/__tests__/en-catalog.ts"), enCatalogSrc);

  if (stringsOnly) return;

  for (const file of i18nFiles()) {
    let src = readFileSync(file, "utf8");
    const pivot = rewritePivot(src);
    if (pivot) {
      writeFileSync(file, pivot);
      continue;
    }
    src = stripKeyFirst(src);
    src = stripLocaleBlocks(src);
    src = stripDeEsProps(src);
    writeFileSync(file, src);
  }
}

await main();
