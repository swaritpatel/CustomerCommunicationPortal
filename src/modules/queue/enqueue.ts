import { Queue, type JobsOptions } from "bullmq";

import { chatLog } from "@/modules/chat/log";
import { CCP_QUEUE_NAME, type CcpJob } from "@/modules/queue/jobs";
import { getQueueConnection } from "@/modules/queue/connection";

let queue: Queue<CcpJob> | null | undefined;

const defaultJobOptions: JobsOptions = {
  attempts: 4,
  backoff: {
    type: "exponential",
    delay: 1_500,
  },
  removeOnComplete: {
    count: 1_000,
  },
  removeOnFail: {
    count: 5_000,
  },
};

function getQueue() {
  if (queue !== undefined) {
    return queue;
  }

  const connection = getQueueConnection();
  if (!connection) {
    queue = null;
    return queue;
  }

  queue = new Queue<CcpJob>(CCP_QUEUE_NAME, {
    connection,
    defaultJobOptions,
  });

  return queue;
}

export async function enqueueBackgroundJob(job: CcpJob, options?: JobsOptions) {
  const backgroundQueue = getQueue();
  if (!backgroundQueue) {
    return false;
  }

  try {
    await backgroundQueue.add(job.kind, job, options);
    return true;
  } catch (error) {
    chatLog("warn", "queue_enqueue_failed", {
      kind: job.kind,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return false;
  }
}
