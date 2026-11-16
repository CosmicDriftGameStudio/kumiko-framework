export type StreamWithPrefix = {
  readonly prefix: Uint8Array;
  readonly body: ReadableStream<Uint8Array>;
};

export async function readStreamWithPrefix(
  source: AsyncIterable<Uint8Array>,
  prefixByteCount: number,
): Promise<StreamWithPrefix> {
  const iterator = source[Symbol.asyncIterator]();
  const bufferedChunks: Uint8Array[] = [];
  let bufferedByteCount = 0;
  let isSourceDone = false;

  // At least one pull, so a missing object throws here, before response headers go out.
  do {
    const next = await iterator.next();
    if (next.done) {
      isSourceDone = true;
      break;
    }
    bufferedChunks.push(next.value);
    bufferedByteCount += next.value.length;
  } while (bufferedByteCount < prefixByteCount);

  const firstChunk = bufferedChunks[0];
  let prefix: Uint8Array;
  if (!firstChunk) {
    prefix = new Uint8Array(0);
  } else if (firstChunk.length >= prefixByteCount) {
    prefix = firstChunk.subarray(0, prefixByteCount);
  } else {
    prefix = new Uint8Array(Math.min(prefixByteCount, bufferedByteCount));
    let offset = 0;
    for (const chunk of bufferedChunks) {
      if (offset >= prefix.length) break;
      const part = chunk.subarray(0, prefix.length - offset);
      prefix.set(part, offset);
      offset += part.length;
    }
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const buffered = bufferedChunks.shift();
      if (buffered) {
        controller.enqueue(buffered);
        return;
      }
      if (isSourceDone) {
        controller.close();
        return;
      }
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  return { prefix, body };
}
