// Metric + Meter contract. Feature code interacts through ctx.metrics
// (MetricsHandle); the framework wires Counter/Histogram/Gauge behind that.

export type MetricLabels = Record<string, string | number | boolean>;

export type MetricType = "counter" | "histogram" | "gauge";

export type MetricDefinition = {
  // Fully-qualified name (with kumiko_<feature>_ prefix already applied).
  readonly name: string;
  readonly type: MetricType;
  readonly description?: string;
  // Declared label keys. Inc/observe calls with unknown label keys throw.
  readonly labels?: readonly string[];
  // Buckets only for histogram. If omitted, provider-default is used.
  readonly buckets?: readonly number[];
  readonly unit?: string;
  // If true, the framework auto-injects tenant_id from the active ctx.
  // Default false — adding tenant_id multiplies cardinality by tenant count.
  readonly tenantLabel?: boolean;
};

export interface Counter {
  inc(value?: number, labels?: MetricLabels): void;
}

export interface Histogram {
  observe(value: number, labels?: MetricLabels): void;
}

export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
  inc(value?: number, labels?: MetricLabels): void;
  dec(value?: number, labels?: MetricLabels): void;
}

export interface Meter {
  // Called once per metric during boot. Duplicate names throw.
  registerMetric(def: MetricDefinition): void;
  // Lookup by fully-qualified name. Unknown names throw — typed access only.
  counter(name: string): Counter;
  histogram(name: string): Histogram;
  gauge(name: string): Gauge;
  // List of registered definitions — used by ctx.metrics to validate labels.
  definitions(): ReadonlyMap<string, MetricDefinition>;
}

// Public handle for feature code — ctx.metrics.
// Name resolution uses the fully-qualified name (kumiko_<feature>_<short>).
// The registrar resolves the short name from the calling feature context
// at boot time; at handler time the map is ready.
export interface MetricsHandle {
  inc(name: string, labels?: MetricLabels, value?: number): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  set(name: string, value: number, labels?: MetricLabels): void;
}
