export type MetricKind = "cpu" | "memory" | "network";

/** Format a Railway metric sample (CPU in vCPU, memory in GB, network in GB). */
export function formatMetric(kind: MetricKind, value: number, precise = false): string {
  if (!Number.isFinite(value)) return "—";
  switch (kind) {
    case "cpu":
      if (value === 0) return "0 vCPU";
      if (value < 0.01) return `${value.toFixed(precise ? 4 : 3)} vCPU`;
      if (value < 1) return `${value.toFixed(precise ? 3 : 2)} vCPU`;
      return `${value.toFixed(2)} vCPU`;
    case "memory":
      if (value < 1) return `${Math.round(value * 1024)} MB`;
      return `${value.toFixed(2)} GB`;
    case "network": {
      const mb = value * 1024;
      if (mb === 0) return "0 MB";
      if (mb < 0.1) return `${(mb * 1024).toFixed(0)} KB`;
      return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
    }
  }
}
