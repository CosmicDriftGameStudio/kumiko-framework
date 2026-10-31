import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export type StaticHtmlPage = { readonly path: string; readonly html: string };

function assertSafePagePath(path: string): void {
  if (isAbsolute(path) || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`writeStaticHtmlPages: page path "${path}" must be relative and use "/" only`);
  }
  if (path.split("/").includes("..")) {
    throw new Error(`writeStaticHtmlPages: page path "${path}" must not contain ".." segments`);
  }
}

export async function writeStaticHtmlPages(
  outDir: string,
  pages: readonly StaticHtmlPage[],
): Promise<void> {
  for (const page of pages) assertSafePagePath(page.path);
  for (const page of pages) {
    const file = join(outDir, page.path, "index.html");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, page.html, "utf-8");
  }
}
