import type { ParakeetModel } from "../conversation.js";

/** The durable assistant's provider/model ids, shared by browser and terminal. */
export function formatModelIdentity(model: ParakeetModel): string {
  const prefix = `${model.provider}/`;
  return model.model.startsWith(prefix)
    ? model.model
    : `${prefix}${model.model}`;
}
