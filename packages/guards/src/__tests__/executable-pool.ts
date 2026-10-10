import { chmodSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// macOS scans every freshly written executable on its first exec (about 300 ms,
// seconds under load). A hardlink to an inode that was already executed skips
// the scan, so fixtures with identical content share one inode instead of
// writing a new file per test. Pooled files must never be written to afterwards.
export function createExecutablePool(poolDir: string): (path: string, content: string) => void {
  mkdirSync(poolDir, { recursive: true });
  const pooledByContent = new Map<string, string>();
  return (path, content) => {
    let pooled = pooledByContent.get(content);
    if (pooled === undefined) {
      pooled = join(poolDir, String(pooledByContent.size));
      writeFileSync(pooled, content);
      chmodSync(pooled, 0o755);
      pooledByContent.set(content, pooled);
    }
    linkSync(pooled, path);
  };
}
