import { Queue } from "bullmq";
import type { JobRunIn } from "../engine/types/index.ts";
import { parseRedisOpts } from "./job-runner-helpers.ts";
import { queueNameFor } from "./job-runner-schedulers.ts";

const JOB_RUNNER_LANES = ["api", "worker"] as const satisfies readonly JobRunIn[];

export type ObliterateJobQueuesOptions = {
  readonly redisUrl: string;
  readonly queueNamePrefix: string;
  readonly bullmqPrefix?: string | undefined;
};

// Deletes the lane queues of a disposable runner by name, so the cost is the queues' own size
// instead of a SCAN over the whole Redis. The runner must be stopped first.
export async function obliterateJobQueues(options: ObliterateJobQueuesOptions): Promise<void> {
  const connection = parseRedisOpts(options.redisUrl);
  await Promise.all(
    JOB_RUNNER_LANES.map(async (lane) => {
      // skipMetasUpdate: a fresh Queue otherwise writes its meta key again after obliterate removed it.
      const queue = new Queue(queueNameFor(options.queueNamePrefix, lane), {
        connection,
        prefix: options.bullmqPrefix ?? "bull",
        skipMetasUpdate: true,
      });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }),
  );
}
