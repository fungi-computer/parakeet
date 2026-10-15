import * as Redacted from "effect/Redacted";

/** Report an operation failure without exposing Session or tool contents. */
export function reportFailure(operation: string, cause: unknown): void {
  console.error(
    JSON.stringify({
      event: "parakeet_operation_failed",
      operation,
      causeKind: cause instanceof Error ? "error" : "non_error",
    }),
    Redacted.make(cause),
  );
}
