#!/usr/bin/env bun
// Codemod 05: Shebangs
//
// Transforms:
//   #!/usr/bin/env node     → #!/usr/bin/env bun
//   #!/usr/bin/env node -r... → manual review (loader args nicht 1:1 portierbar)
//
// Idempotent: läuft 2× = 1×.

import { Glob } from "bun";
import { resolve, relative } from "node:path";

const PROJECT_ROOT = process.argv[2] ?? process.cwd();

const SHEBANG_NODE_SIMPLE = /^#!\/usr\/bin\/env node\s*$/m;
const SHEBANG_NODE_COMPLEX = /^#!\/usr\/bin\/env node\s+[-\w]+/m;
const REPLACEMENT = "#!/usr/bin/env bun";

const EXTENSIONS = ["ts", "tsx", "js", "mjs", "cjs"];

async function transformFile(path: string): Promise<{ changed: boolean; complex: boolean }> {
  const text = await Bun.file(path).text();
  if (!text.startsWith("#!")) return { changed: false, complex: false };

  if (SHEBANG_NODE_COMPLEX.test(text)) {
    return { changed: false, complex: true };
  }

  if (SHEBANG_NODE_SIMPLE.test(text)) {
    const next = text.replace(SHEBANG_NODE_SIMPLE, REPLACEMENT);
    await Bun.write(path, next);
    return { changed: true, complex: false };
  }

  return { changed: false, complex: false };
}

async function main(): Promise<void> {
  console.log(`[codemod 05-shebangs] project: ${PROJECT_ROOT}`);

  const EXCLUDE_PATTERNS = ["/node_modules/", "/dist/", "/build/", "/.next/"];
  let touched = 0;
  const complexFiles: string[] = [];

  for (const ext of EXTENSIONS) {
    const glob = new Glob(`**/*.${ext}`);
    for await (const file of glob.scan({ cwd: PROJECT_ROOT, dot: false })) {
      const abs = resolve(PROJECT_ROOT, file);
      if (EXCLUDE_PATTERNS.some((p) => abs.includes(p))) continue;

      const { changed, complex } = await transformFile(abs);
      if (changed) touched++;
      if (complex) complexFiles.push(relative(PROJECT_ROOT, abs));
    }
  }

  console.log(`[codemod 05-shebangs] transformed ${touched} files`);

  if (complexFiles.length) {
    console.log(`[codemod 05-shebangs] manual review — complex shebangs (loader args, esm flags):`);
    for (const f of complexFiles) console.log(`  ${f}`);
  }
}

await main();
