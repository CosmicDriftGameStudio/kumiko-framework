// The renderer-web stylesheet references its IBM Plex woff2 files by absolute
// same-origin URL. Relative url() would 404: the CSS is compiled into a temp
// dir (dev) or hashed into dist/assets (prod), away from the source fonts.
// data: URIs are out because apps run with `font-src 'self'`.

import { dirname, join } from "node:path";
import { resolveInstalledSync } from "./resolve-installed-package.ts";

export const RENDERER_WEB_FONTS_URL_PREFIX = "/assets/kumiko/fonts/";

/** dist-relative folder the prod build copies the fonts into. */
export const RENDERER_WEB_FONTS_DIST_DIR = "assets/kumiko/fonts";

/** Allowlist for servable font file names; also rules out path segments. */
export const RENDERER_WEB_FONT_FILE_PATTERN = /^[a-z0-9-]+\.woff2$/;

/** Directory of the woff2 files next to renderer-web's styles.css, or
 *  undefined when the package can't be resolved from any `searchFrom` dir
 *  (or outside Bun, which does the package-exports resolution). */
export function resolveRendererWebFontsDir(searchFrom: readonly string[]): string | undefined {
  for (const from of searchFrom) {
    const stylesheet = resolveInstalledSync("@cosmicdrift/kumiko-renderer/web/styles.css", from);
    if (stylesheet !== undefined) return join(dirname(stylesheet), "fonts");
  }
  return undefined;
}
