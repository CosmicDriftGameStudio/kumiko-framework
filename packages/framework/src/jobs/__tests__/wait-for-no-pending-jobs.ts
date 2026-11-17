import { expect } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import type { JobRunner } from "../job-runner-types.ts";

// A negative assertion ("nothing else ran") only holds once the queue is idle;
// the pending count is that barrier instead of a fixed sleep.
export async function waitForNoPendingJobs(
  runner: Pick<JobRunner, "countPendingJobs">,
): Promise<void> {
  await waitFor(async () => {
    expect(await runner.countPendingJobs()).toBe(0);
  });
}
