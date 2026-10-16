import { describe, expect, test } from "bun:test";
import {
  type AuditProcess,
  BunAuditUnavailableError,
  runBunAuditOnce,
} from "../_lib/security-audit";

// Emits `output` on stdout and only ends once kill() is called, like a hung
// `bun audit` that the timeout has to terminate.
function hangingProcess(output: string): AuditProcess {
  let release: () => void = () => {};
  const killed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encoder = new TextEncoder();
  const stdout = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (output !== "") controller.enqueue(encoder.encode(output));
      await killed;
      controller.close();
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    async start(controller) {
      await killed;
      controller.close();
    },
  });
  return {
    stdout,
    stderr,
    exited: killed.then(() => 143),
    kill: release,
  };
}

function finishedProcess(output: string): AuditProcess {
  const encoder = new TextEncoder();
  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (text !== "") controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  return {
    stdout: stream(output),
    stderr: stream(""),
    exited: Promise.resolve(0),
    kill: () => {},
  };
}

describe("runBunAuditOnce", () => {
  test("empty streams after a self-kill report the timeout", async () => {
    const error = await runBunAuditOnce("/root", 20, () => hangingProcess("")).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BunAuditUnavailableError);
    expect((error as Error).message).toContain("exceeding its 20ms timeout");
  });

  test("truncated JSON after a self-kill is unavailable, not a parse error", async () => {
    const error = await runBunAuditOnce("/root", 20, () =>
      hangingProcess('{"advisories": [{"id"'),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BunAuditUnavailableError);
    expect((error as Error).message).toContain("exceeding its 20ms timeout");
  });

  test("broken JSON without a timeout stays a generic error", async () => {
    const error = await runBunAuditOnce("/root", 5_000, () =>
      finishedProcess('{"advisories": [{"id"'),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BunAuditUnavailableError);
    expect((error as Error).message).toContain("non-JSON");
  });
});
