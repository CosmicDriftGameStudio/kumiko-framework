import { RecordingMeter, type MetricEvent } from "./recording-meter";
import { RecordingTracer, type RecordedSpan } from "./recording-tracer";
import { DEFAULT_SENSITIVE_CONFIG, mergeSensitiveConfig } from "./sensitive-filter";
import type { ObservabilityProvider, ObservabilityOptions } from "./types";

type ConsoleWriter = {
  readonly log: (line: string) => void;
};

export type ConsoleProviderOptions = ObservabilityOptions & {
  readonly writer?: ConsoleWriter;
  // If true, buffer spans until the root span ends and then print the full
  // tree at once. If false, each span prints as it ends. Default true —
  // tree output is dramatically more readable.
  readonly bufferUntilRoot?: boolean;
};

// Pretty-print a span-tree rooted at `root` into a multi-line string.
function renderTree(
  root: RecordedSpan,
  children: ReadonlyMap<string | undefined, readonly RecordedSpan[]>,
): string {
  const lines: string[] = [];
  const render = (span: RecordedSpan, prefix: string, isLast: boolean, isRoot: boolean) => {
    const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const duration =
      span.endTime !== undefined
        ? `${(span.endTime - span.startTime).toFixed(1)}ms`
        : "(unfinished)";
    const statusTag =
      span.status === "error" ? " [ERR]" : span.status === "ok" ? "" : "";
    lines.push(`${prefix}${connector}${span.name} (${duration})${statusTag}`);

    const attrKeys = Object.keys(span.attributes);
    const nextPrefix = isRoot ? "  " : `${prefix}${isLast ? "   " : "│  "}`;
    if (attrKeys.length > 0) {
      for (const key of attrKeys) {
        const value = span.attributes[key];
        lines.push(`${nextPrefix}  ${key}=${String(value)}`);
      }
    }
    if (span.exception) {
      lines.push(`${nextPrefix}  !exception=${span.exception.name}: ${span.exception.message}`);
    }

    const kids = children.get(span.spanId) ?? [];
    kids.forEach((child, i) => {
      render(child, nextPrefix, i === kids.length - 1, false);
    });
  };
  render(root, "", true, true);
  return lines.join("\n");
}

function groupByParent(
  spans: readonly RecordedSpan[],
): ReadonlyMap<string | undefined, readonly RecordedSpan[]> {
  const map = new Map<string | undefined, RecordedSpan[]>();
  for (const s of spans) {
    const list = map.get(s.parentSpanId) ?? [];
    list.push(s);
    map.set(s.parentSpanId, list);
  }
  // Sort children by startTime for stable output.
  for (const [, list] of map) {
    list.sort((a, b) => a.startTime - b.startTime);
  }
  return map;
}

export function createConsoleProvider(
  options: ConsoleProviderOptions = {},
): ObservabilityProvider {
  const writer = options.writer ?? { log: (line) => console.log(line) };
  const sensitiveConfig = mergeSensitiveConfig(
    options.sensitiveFilter ?? DEFAULT_SENSITIVE_CONFIG,
  );
  const bufferUntilRoot = options.bufferUntilRoot !== false;

  // Per-trace buffer. Once the root (parentSpanId === undefined) ends, we
  // render and flush. Child spans that arrive after the root ends are
  // printed immediately as orphans — shouldn't happen in practice but
  // safer than losing them.
  const buffer = new Map<string, RecordedSpan[]>();
  const rootSeen = new Map<string, RecordedSpan>();

  const handleSpanEnd = (span: RecordedSpan) => {
    if (!bufferUntilRoot) {
      writer.log(renderTree(span, new Map([[span.parentSpanId, []]])));
      return;
    }
    const bucket = buffer.get(span.traceId) ?? [];
    bucket.push(span);
    buffer.set(span.traceId, bucket);
    if (span.parentSpanId === undefined) {
      rootSeen.set(span.traceId, span);
    }
    const root = rootSeen.get(span.traceId);
    if (root && span.spanId === root.spanId) {
      const children = groupByParent(bucket);
      writer.log(renderTree(root, children));
      buffer.delete(span.traceId);
      rootSeen.delete(span.traceId);
    }
  };

  const handleMetric = (event: MetricEvent) => {
    const labelStr = event.labels
      ? ` {${Object.entries(event.labels)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")}}`
      : "";
    writer.log(`[metric] ${event.type} ${event.name}${labelStr} value=${event.value}`);
  };

  const tracer = new RecordingTracer({ sensitiveConfig, onSpanEnd: handleSpanEnd });
  const meter = new RecordingMeter(handleMetric);

  return {
    name: "console",
    tracer,
    meter,
    async shutdown() {
      // Flush any orphaned spans (trace whose root never arrived).
      for (const [traceId, bucket] of buffer) {
        for (const s of bucket) {
          writer.log(`[orphan-span ${traceId}] ${s.name}`);
        }
      }
      buffer.clear();
      rootSeen.clear();
    },
  };
}
