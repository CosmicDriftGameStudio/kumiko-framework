import type { ReactNode } from "react";
import {
  type BatchResult,
  type Command,
  createStore,
  type Dispatcher,
  type DispatcherStatus,
  type QueryOpts,
  type QueryResult,
  type StreamOpts,
  type WritableStore,
  type WriteOpts,
  type WriteResult,
} from "./headless/index.ts";
import type { CorePrimitives } from "./primitives.tsx";

export type MockWriteHandler = (
  type: string,
  payload: unknown,
  opts?: WriteOpts,
) => WriteResult<unknown> | Promise<WriteResult<unknown>>;

export type MockQueryHandler = (
  type: string,
  payload: unknown,
  opts?: QueryOpts,
) => QueryResult<unknown> | Promise<QueryResult<unknown>>;

export type MockBatchHandler = (
  commands: readonly Command[],
  opts?: WriteOpts,
) => BatchResult | Promise<BatchResult>;

export type MockStreamHandler = (
  type: string,
  payload: unknown,
  opts?: StreamOpts,
) => AsyncGenerator<unknown, void, undefined>;

export type MockDispatcherOptions = {
  readonly initialStatus?: DispatcherStatus;
  readonly write?: MockWriteHandler;
  readonly query?: MockQueryHandler;
  readonly batch?: MockBatchHandler;
  readonly stream?: MockStreamHandler;
};

export type MockDispatcher = Dispatcher & {
  readonly statusStore: WritableStore<DispatcherStatus>;
};

export function createMockDispatcher(options: MockDispatcherOptions = {}): MockDispatcher {
  const writeHandler: MockWriteHandler = options.write ?? (() => ({ isSuccess: true, data: {} }));
  const queryHandler: MockQueryHandler = options.query ?? (() => ({ isSuccess: true, data: {} }));
  const streamHandler: MockStreamHandler = options.stream ?? (async function* () {});

  // TData/TChunk exist only at the type level: the handler decides the payload, the
  // test asserts on it. The overload states the generic contract without a cast.
  function write<TData = unknown>(
    type: string,
    payload: unknown,
    opts?: WriteOpts,
  ): Promise<WriteResult<TData>>;
  async function write(
    type: string,
    payload: unknown,
    opts?: WriteOpts,
  ): Promise<WriteResult<unknown>> {
    return writeHandler(type, payload, opts);
  }

  function query<TData = unknown>(
    type: string,
    payload: unknown,
    opts?: QueryOpts,
  ): Promise<QueryResult<TData>>;
  async function query(
    type: string,
    payload: unknown,
    opts?: QueryOpts,
  ): Promise<QueryResult<unknown>> {
    return queryHandler(type, payload, opts);
  }

  function stream<TChunk = unknown>(
    type: string,
    payload: unknown,
    opts?: StreamOpts,
  ): AsyncGenerator<TChunk, void, undefined>;
  function stream(
    type: string,
    payload: unknown,
    opts?: StreamOpts,
  ): AsyncGenerator<unknown, void, undefined> {
    return streamHandler(type, payload, opts);
  }

  return {
    write,
    query,
    batch: async (commands, opts) =>
      options.batch ? options.batch(commands, opts) : { isSuccess: true, results: [] },
    stream,
    statusStore: createStore<DispatcherStatus>(options.initialStatus ?? "online"),
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

// Stubs render nothing and import no web code, so tests swap primitives without a DOM.
function renderNothing(): ReactNode {
  return null;
}

// Structural wrappers keep their children so content behind them stays testable.
function passChildren({ children }: { readonly children?: ReactNode }): ReactNode {
  return children;
}

const STUB_PRIMITIVES = {
  Button: renderNothing,
  Banner: renderNothing,
  Field: renderNothing,
  Input: renderNothing,
  DataTable: renderNothing,
  EmbeddedListInput: renderNothing,
  Form: renderNothing,
  Section: renderNothing,
  Card: renderNothing,
  Grid: renderNothing,
  GridCell: renderNothing,
  Text: renderNothing,
  Heading: renderNothing,
  Dialog: renderNothing,
  Modal: renderNothing,
  Drawer: renderNothing,
  Lightbox: renderNothing,
  ConfigSourceBadge: renderNothing,
  ConfigCascadeView: renderNothing,
  Link: renderNothing,
  Progress: renderNothing,
  StepBar: renderNothing,
  WizardStepGroup: passChildren,
  Tabs: renderNothing,
  StatusBadge: renderNothing,
  Metric: renderNothing,
  JsonView: renderNothing,
  FileValueList: renderNothing,
  FillContainer: passChildren,
  PageHeader: renderNothing,
  MetricBand: passChildren,
  RecordBreadcrumb: renderNothing,
  RecordSummary: renderNothing,
  PhotoGrid: renderNothing,
  StepList: renderNothing,
  RecordSteps: renderNothing,
  ActionOverflowMenu: renderNothing,
  SecretReveal: renderNothing,
  StickyActionBar: renderNothing,
  CopyButton: renderNothing,
  ShareButton: renderNothing,
  PromoPanel: renderNothing,
  EmptyState: renderNothing,
} satisfies CorePrimitives;

export function createStubPrimitives(overrides: Partial<CorePrimitives> = {}): CorePrimitives {
  return { ...STUB_PRIMITIVES, ...overrides };
}
