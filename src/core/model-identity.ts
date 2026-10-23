import type { ParakeetModel } from "../conversation.js";

/** The durable assistant's provider/model ids, shared by browser and terminal. */
export function formatModelIdentity(model: ParakeetModel): string {
  const prefix = `${model.provider}/`;
  return model.model.startsWith(prefix)
    ? model.model
    : `${prefix}${model.model}`;
}

/** The model identity with its thinking level, "provider/model (level)"; no level, no suffix. */
export function formatModelWithLevel(
  model: ParakeetModel,
  level: string | undefined,
): string {
  return level === undefined
    ? formatModelIdentity(model)
    : `${formatModelIdentity(model)} (${level})`;
}
