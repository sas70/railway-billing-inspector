export type RailwayErrorKind = "auth" | "not_found" | "rate_limit" | "validation" | "server" | "network" | "graphql";

export class RailwayApiError extends Error {
  readonly kind: RailwayErrorKind;
  readonly operation: string;
  readonly status?: number;
  readonly traceIds: string[];
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    opts: { kind: RailwayErrorKind; operation: string; status?: number; traceIds?: string[]; retryAfterSec?: number },
  ) {
    super(message);
    this.name = "RailwayApiError";
    this.kind = opts.kind;
    this.operation = opts.operation;
    this.status = opts.status;
    this.traceIds = opts.traceIds ?? [];
    this.retryAfterSec = opts.retryAfterSec;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
