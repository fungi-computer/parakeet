import type {
  WhistleContribution,
  WhistleExecutionInput,
  WhistleRuntime,
} from "@fungi.computer/whistle";

import { keyBindings, slashRegistry } from "./slash.js";

/** The few commands every Parakeet client has, whatever the backend offers. */
export type ParakeetBuiltinOptions = Readonly<{
  /** Clear the composer draft and any notice. */
  clear: () => void;
  /** Open the renderer-owned all-command palette, when one exists. */
  showCommands?: (() => void | Promise<void>) | undefined;
}>;

/** Run a chosen command after the choosing command has settled. */
function runAfter(
  runtime: Pick<WhistleRuntime, "execute">,
  commandId: string,
  origin: WhistleExecutionInput["origin"],
) {
  setTimeout(() => {
    void runtime.execute(commandId, { origin });
  }, 0);
}

/**
 * `/help` lists the live commands (built-in and advertised) and runs the one
 * chosen; `/keys` does the same for key bindings; `/clear` empties the
 * composer.
 */
export function parakeetBuiltinCommands(
  runtime: Pick<WhistleRuntime, "snapshot" | "execute">,
  options: ParakeetBuiltinOptions,
): WhistleContribution["commands"] {
  return [
    {
      id: "help",
      title: "Show commands",
      category: "Advanced",
      projections: {
        help: { order: -3 },
        slash: { aliases: ["help"], order: -3 },
      },
      handler: async (input: WhistleExecutionInput) => {
        if (options.showCommands !== undefined) {
          await options.showCommands();
          return undefined;
        }
        const commands = slashRegistry(runtime.snapshot()).filter(
          (command) => command.alias !== "help",
        );
        if (input.interaction === undefined)
          return commands.map((command) => `/${command.alias}`);
        const chosen = await input.interaction.prompt({
          type: "choice",
          message: "Commands",
          options: commands.map((command) => ({
            value: command.commandId,
            label: `/${command.alias}`,
            description:
              command.keys.length === 0
                ? command.title
                : `${command.title} · ${command.keys.join(", ")}`,
          })),
        });
        runAfter(runtime, chosen, input.origin);
        return undefined;
      },
    },
    {
      id: "keys",
      title: "Show key bindings",
      category: "Advanced",
      projections: {
        help: { order: -2 },
        slash: { aliases: ["keys"], order: -2, consumesDraft: true },
      },
      handler: async (input: WhistleExecutionInput) => {
        const keys = keyBindings(runtime.snapshot());
        if (input.interaction === undefined)
          return keys.map((row) => `${row.keys} ${row.title}`);
        if (keys.length === 0) {
          input.interaction.notify({
            type: "info",
            message: "No key bindings are active.",
          });
          return undefined;
        }
        const chosen = await input.interaction.prompt({
          type: "choice",
          message: "Key bindings",
          options: keys.map((row) => ({
            value: row.commandId,
            label: row.title,
            description: row.keys,
          })),
        });
        runAfter(runtime, chosen, input.origin);
        return undefined;
      },
    },
    {
      id: "clear",
      title: "Clear the composer",
      category: "Advanced",
      projections: {
        help: { order: -1 },
        slash: { aliases: ["clear"], order: -1 },
      },
      handler: () => {
        options.clear();
      },
    },
  ];
}
