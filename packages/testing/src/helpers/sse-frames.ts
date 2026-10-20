export type SseFrame = {
  readonly event: string | undefined;
  readonly data: string;
  readonly id: string | undefined;
};

export type ReadSseFramesOptions = {
  readonly until: (frame: SseFrame, all: readonly SseFrame[]) => boolean;
  readonly skipPings?: boolean;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

export async function readSseFrames(
  response: Response,
  options: ReadSseFramesOptions,
): Promise<SseFrame[]> {
  if (response.body === null) {
    throw new Error("sse response has no body");
  }
  const skipPings = options.skipPings ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`sse read timed out after ${timeoutMs}ms: ${frames.length} frames read`)),
      timeoutMs,
    );
  });

  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), timedOut]);
      if (chunk.done) {
        throw new Error(`sse stream ended before condition: ${frames.length} frames read`);
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const rawFrame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const frame = parseFrame(rawFrame);
        if (frame !== undefined && !(skipPings && frame.event === "ping")) {
          frames.push(frame);
          if (options.until(frame, frames)) {
            return frames;
          }
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

function parseFrame(rawFrame: string): SseFrame | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of rawFrame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") dataLines.push(value);
  }
  if (event === undefined && id === undefined && dataLines.length === 0) {
    return undefined;
  }
  return { event, data: dataLines.join("\n"), id };
}
