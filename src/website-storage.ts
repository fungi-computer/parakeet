import * as Data from "effect/Data";
import * as Result from "effect/Result";

class BrowserStorageUnavailable extends Data.TaggedError(
  "BrowserStorageUnavailable",
)<{ readonly cause: unknown }> {}

type SafeCause = Readonly<{ name: string; cause?: SafeCause }>;

function describeCause(cause: unknown, depth = 0): SafeCause {
  if (!(cause instanceof Error)) return { name: "NonError" };
  if (cause.cause !== undefined && depth < 3)
    return {
      name: cause.name,
      cause: describeCause(cause.cause, depth + 1),
    };
  return { name: cause.name };
}

/** A blocked visitor iframe may refuse access to its partitioned local storage. */
function accessStorage<A>(
  stage: "read" | "write" | "remove",
  operation: (storage: Storage) => A,
): Result.Result<A, BrowserStorageUnavailable> {
  return Result.try({
    try: () => operation(globalThis.localStorage),
    catch: (cause) => {
      const error = new BrowserStorageUnavailable({ cause });
      console.warn(
        JSON.stringify({
          event: "browser_storage_unavailable",
          level: "warn",
          code: "local",
          stage,
          cause: describeCause(error),
        }),
      );
      return error;
    },
  });
}

/** Storage failure stays distinct from absence; a live visitor keeps its state. */
export const embedStorage = {
  read: (key: string) =>
    accessStorage("read", (storage) => storage.getItem(key)),
  write: (key: string, value: string) =>
    accessStorage("write", (storage) => {
      storage.setItem(key, value);
    }),
  remove: (key: string) =>
    accessStorage("remove", (storage) => {
      storage.removeItem(key);
    }),
};
