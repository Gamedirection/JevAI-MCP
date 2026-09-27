type LabelValue = string | number;
type Labels = Record<string, LabelValue>;

function labelKey(labels: Labels): string {
   return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(",");
}

class LabeledValue {
   private values = new Map<string, number>();

   constructor(
      private readonly base: Labels = {},
      private readonly initial: number = 0,
       ) {}

   private key(labels?: Labels): string {
      return labelKey({ ...this.base, ...(labels ?? {}) });
    }

   inc(by = 1, labels?: Labels): void {
      const key = this.key(labels);
      this.values.set(key, (this.values.get(key) ?? this.initial) + by);
      }

   set(value: number, labels?: Labels): void {
      this.values.set(this.key(labels), value);
      }

   get(labels?: Labels): number {
      return this.values.get(this.key(labels)) ?? 0;
      }

   entries(): Array<{ labels: Labels; value: number }> {
      return [...this.values.entries()].map(([key, value]) => ({
         labels: key === "" ? { ...this.base } : { ...this.base, ...parseLabelKey(key) },
         value,
            }));
      }
}

function parseLabelKey(key: string): Labels {
   const out: Labels = {};
   const re = /([^=,]+)="((?:[^"\\]|\\.)*)"/g;
   let match = re.exec(key);
   while (match) {
      out[match[1]!] = match[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      match = re.exec(key);
      }
   return out;
}

export interface MetricDefinition {
   name: string;
   help: string;
   type: "counter" | "gauge" | "histogram";
   labelNames?: string[];
   buckets?: number[];
}

class Histogram {
   private readonly observations = new Map<string, { counts: number[]; sum: number; total: number }>();

   constructor(
      private readonly base: Labels,
      private readonly bucketValues: number[],
       ) {}

   observe(value: number, labels?: Labels): void {
      const key = labelKey({ ...this.base, ...(labels ?? {}) });
      let state = this.observations.get(key);
      if (!state) {
         state = { counts: new Array(this.bucketValues.length).fill(0), sum: 0, total: 0 };
         this.observations.set(key, state);
            }
      state.sum += value;
      state.total += 1;
      for (let i = 0; i < this.bucketValues.length; i += 1) {
         if (value <= this.bucketValues[i]!) state.counts[i] = (state.counts[i] ?? 0) + 1;
            }
      }

   entries(): Array<{ labels: Labels; buckets: { le: number; count: number }[]; sum: number; total: number }> {
      return [...this.observations.entries()].map(([key, state]) => ({
         labels: { ...this.base, ...parseLabelKey(key === labelKey(this.base) ? "" : key) },
         buckets: state.counts.map((count, i) => ({ le: this.bucketValues[i]!, count })),
         sum: state.sum,
         total: state.total,
            }));
      }
}

export class MetricRegistry {
   private counters = new Map<string, { def: MetricDefinition; metric: LabeledValue }>();
   private gauges = new Map<string, { def: MetricDefinition; metric: LabeledValue }>();
   private histograms = new Map<string, { def: MetricDefinition; metric: Histogram }>();

   counter(name: string, help: string): LabeledValue {
      let entry = this.counters.get(name);
      if (!entry) {
         entry = { def: { name, help, type: "counter" }, metric: new LabeledValue() };
         this.counters.set(name, entry);
            }
      return entry.metric;
      }

   gauge(name: string, help: string): LabeledValue {
      let entry = this.gauges.get(name);
      if (!entry) {
         entry = { def: { name, help, type: "gauge" }, metric: new LabeledValue() };
         this.gauges.set(name, entry);
            }
      return entry.metric;
      }

   histogram(name: string, help: string, buckets: number[]): Histogram {
      let entry = this.histograms.get(name);
      if (!entry) {
         entry = { def: { name, help, type: "histogram", buckets }, metric: new Histogram({}, buckets) };
         this.histograms.set(name, entry);
            }
      return entry.metric;
      }

   render(): string {
      const lines: string[] = [];
      for (const { def, metric } of this.counters.values()) {
         lines.push(`# HELP ${def.name} ${def.help}`, `# TYPE ${def.name} counter`);
         for (const { labels, value } of metric.entries()) {
               lines.push(`${def.name}${wrapLabels(labels)} ${value}`);
                  }
            }
      for (const { def, metric } of this.gauges.values()) {
         lines.push(`# HELP ${def.name} ${def.help}`, `# TYPE ${def.name} gauge`);
         for (const { labels, value } of metric.entries()) {
               lines.push(`${def.name}${wrapLabels(labels)} ${value}`);
                  }
            }
      for (const { def, metric } of this.histograms.values()) {
         lines.push(`# HELP ${def.name} ${def.help}`, `# TYPE ${def.name} histogram`);
         for (const entry of metric.entries()) {
               for (const bucket of entry.buckets) {
                     lines.push(
                           `${def.name}_bucket${wrapLabels({ ...entry.labels, le: bucket.le })} ${bucket.count}`,
                              );
                     }
               lines.push(`${def.name}_bucket${wrapLabels({ ...entry.labels, le: "+Inf" })} ${entry.total}`);
               lines.push(`${def.name}_sum${wrapLabels(entry.labels)} ${entry.sum}`);
               lines.push(`${def.name}_count${wrapLabels(entry.labels)} ${entry.total}`);
                  }
            }
      return `${lines.join("\n")}\n`;
      }
}

function wrapLabels(labels: Labels): string {
   const key = labelKey(labels);
   return key === "" ? "" : `{${key}}`;
}

export const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface JevaiMetrics {
   registry: MetricRegistry;
   requestsTotal: LabeledValue;
   requestsSuccessTotal: LabeledValue;
   requestsFailedTotal: LabeledValue;
   requestDuration: Histogram;
   inputTokensTotal: LabeledValue;
   disconnectsTotal: LabeledValue;
   activeClients: LabeledValue;
   httpRequestsTotal: LabeledValue;
   httpDuration: Histogram;
   jevUpstream: LabeledValue;
}

export function createMetrics(version: string): JevaiMetrics {
   const registry = new MetricRegistry();
   const requestsTotal = registry.counter(
      "jevai_requests_total",
      "Total MCP decision requests by caller and tool.",
      );
   const requestsSuccessTotal = registry.counter(
      "jevai_requests_success_total",
      "Successful MCP decision requests by caller and tool.",
      );
   const requestsFailedTotal = registry.counter(
      "jevai_requests_failed_total",
      "Failed MCP decision requests by caller, tool and error category.",
      );
   const requestDuration = registry.histogram(
      "jevai_request_duration_seconds",
      "MCP decision request duration in seconds.",
      LATENCY_BUCKETS,
      );
   const inputTokensTotal = registry.counter(
      "jevai_input_tokens_total",
      "Jev input tokens consumed.",
      );
   const disconnectsTotal = registry.counter(
      "jevai_disconnects_total",
      "DefAPI connection loss events by failure type.",
      );
   const activeClients = registry.gauge(
      "jevai_active_clients",
      "Distinct callers seen in the last 24 hours (recomputed on scrape).",
      );
   const httpRequestsTotal = registry.counter(
      "jevai_http_requests_total",
      "Dashboard HTTP requests by method, route pattern and status class.",
      );
   const httpDuration = registry.histogram(
      "jevai_http_duration_seconds",
      "Dashboard HTTP request duration in seconds.",
      [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      );
   const jevUpstream = registry.gauge(
      "jevai_jev_upstream",
      "DefAPI connectivity: 1 connected, 0 not.",
      );
   void version;
   return {
      registry,
      requestsTotal,
      requestsSuccessTotal,
      requestsFailedTotal,
      requestDuration,
      inputTokensTotal,
      disconnectsTotal,
      activeClients,
      httpRequestsTotal,
      httpDuration,
      jevUpstream,
      };
}

export type { LabeledValue };
