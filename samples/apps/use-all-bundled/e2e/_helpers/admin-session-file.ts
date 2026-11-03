import { tmpdir } from "node:os";
import { join } from "node:path";

export function adminSessionFileForRunner(runnerPid: number): string {
  return join(tmpdir(), `use-all-bundled-admin-session-${runnerPid}.json`);
}
