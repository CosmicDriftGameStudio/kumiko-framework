import { rmSync } from "node:fs";
import { adminSessionFileForRunner } from "./_helpers/admin-session-file";

// Pids get reused, so a file left by an earlier run must not hand this run expired cookies.
export default function globalSetup(): void {
  rmSync(adminSessionFileForRunner(process.pid), { force: true });
}
