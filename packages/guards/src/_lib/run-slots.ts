import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const DEFAULT_SLOTS = 2;
const POLL_INTERVAL_MS = 1000;
const PIDLESS_ORPHAN_AGE_MS = 60_000;
// Upper bound against pid reuse after SIGKILL/OOM: a reused pid would otherwise hold the slot forever.
// The slot mtime is never refreshed, so this must exceed the longest legitimate guard run.
const MAX_SLOT_AGE_MS = 2 * 60 * 60_000;
const PID_FILE = "pid";

type Environment = Readonly<Record<string, string | undefined>>;

export type GuardRunSlotOptions = {
  readonly slotsDir?: string;
  readonly environment?: Environment;
  readonly pid?: number;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly sleep?: (ms: number) => void;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  // Test seam: real process hooks would intercept signals of the test runner.
  readonly installProcessHooks?: boolean;
};

// 0 = unlimited. CI runners are isolated, so slots only matter on a shared dev machine.
export function resolveGuardSlotCount(environment: Environment): number {
  const ci = environment["CI"];
  if (ci !== undefined && ci !== "") return 0;
  const raw = environment["KUMIKO_GUARD_SLOTS"];
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_SLOTS;
  return Number(raw);
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "unknown";
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return errorCode(error) === "EPERM";
  }
}

// Sync on purpose: runGuardsCli is sync and shared by the fw entry, the guards CLI and `kumiko check`.
function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readSlotPid(slotPath: string): number | undefined {
  try {
    const parsed = Number(readFileSync(join(slotPath, PID_FILE), "utf8").trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isOrphanedSlot(
  slotPath: string,
  isPidAlive: (pid: number) => boolean,
  nowMs: number,
): boolean {
  let ageMs: number;
  try {
    ageMs = nowMs - statSync(slotPath).mtimeMs;
  } catch {
    return false;
  }
  if (ageMs > MAX_SLOT_AGE_MS) return true;
  const ownerPid = readSlotPid(slotPath);
  if (ownerPid !== undefined) return !isPidAlive(ownerPid);
  // No pid file: the owner is either between mkdir and writeFile or died in that gap.
  return ageMs > PIDLESS_ORPHAN_AGE_MS;
}

function tryClaimSlot(slotPath: string, pid: number): boolean {
  try {
    mkdirSync(slotPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  writeFileSync(join(slotPath, PID_FILE), String(pid));
  return true;
}

// ponytail: two waiters judging the same orphan at once can let the slower one move the faster
// one's fresh claim aside, so N+1 runs overlap once. Acceptable for a memory throttle; a per-slot
// generation token would close it if it ever matters.
function removeOrphan(slotPath: string, pid: number): void {
  // rename is atomic, so of several waiters only one deletes the orphan; mkdir stays the decider.
  const graveyard = `${slotPath}.orphan-${pid}-${Math.random().toString(36).slice(2)}`;
  try {
    renameSync(slotPath, graveyard);
  } catch {
    // skip: another waiter already moved the orphan away
    return;
  }
  rmSync(graveyard, { recursive: true, force: true });
}

function createRelease(slotPath: string, pid: number, hooks: boolean): () => void {
  let released = false;
  const release = (): void => {
    // skip: finally and the exit hook both call release
    if (released) return;
    released = true;
    if (hooks) {
      process.off("exit", release);
    }
    // A taken-over slot belongs to someone else by now; never delete theirs.
    if (readSlotPid(slotPath) === pid) rmSync(slotPath, { recursive: true, force: true });
  };
  // No signal handlers: they would suppress default termination, and a signal death is
  // reclaimed by the next run through the dead pid.
  if (hooks) {
    process.on("exit", release);
  }
  return release;
}

function claimFreeSlot(
  slotsDir: string,
  slotCount: number,
  pid: number,
  isPidAlive: (pid: number) => boolean,
  now: () => number,
): string | undefined {
  for (let index = 0; index < slotCount; index++) {
    const slotPath = join(slotsDir, `slot-${index}`);
    if (tryClaimSlot(slotPath, pid)) return slotPath;
    if (!isOrphanedSlot(slotPath, isPidAlive, now())) continue;
    removeOrphan(slotPath, pid);
    if (tryClaimSlot(slotPath, pid)) return slotPath;
  }
  return undefined;
}

// Fixed path, not os.tmpdir(): sandboxed sessions may have a different TMPDIR and would not share slots.
function defaultSlotsDir(): string {
  const uid = process.getuid?.();
  return uid === undefined ? "/tmp/kumiko-guard-slots" : `/tmp/kumiko-guard-slots-${uid}`;
}

// The default dir lives in a shared /tmp: another local user could pre-create it (or swap in a
// symlink) to hold slots forever or redirect the pid write.
function assertPrivateOwnDirectory(dir: string): void {
  const uid = process.getuid?.();
  // skip: no uid to compare against on this platform.
  if (uid === undefined) return;
  const stats = lstatSync(dir);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    stats.uid !== uid ||
    (stats.mode & 0o077) !== 0
  ) {
    throw Object.assign(new Error(`${dir} is not a private directory owned by the current user`), {
      code: "EUNSAFE",
    });
  }
}

export function acquireGuardRunSlot(options: GuardRunSlotOptions = {}): () => void {
  const slotCount = resolveGuardSlotCount(options.environment ?? process.env);
  if (slotCount === 0) return () => {};

  const slotsDir = options.slotsDir ?? defaultSlotsDir();
  const pid = options.pid ?? process.pid;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.error(line));
  const hooks = options.installProcessHooks ?? true;

  let announced = false;
  for (;;) {
    let slotPath: string | undefined;
    try {
      mkdirSync(slotsDir, { recursive: true, mode: 0o700 });
      assertPrivateOwnDirectory(slotsDir);
      slotPath = claimFreeSlot(slotsDir, slotCount, pid, isPidAlive, now);
    } catch (error) {
      // A throttle must never block the push: fail open.
      log(`→ guard slots unavailable (${errorCode(error)}), running without limit`);
      return () => {};
    }
    if (slotPath !== undefined) return createRelease(slotPath, pid, hooks);
    if (!announced) {
      announced = true;
      log(`→ waiting for a free guard slot (${slotCount} in use)`);
    }
    sleep(POLL_INTERVAL_MS);
  }
}
