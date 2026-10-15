import { z } from "zod";
import type { SessionMessage } from "@fungi.computer/shiitake/client";

/** Exact JSON argument object carried by a Pi tool call into Parakeet. */
export const ToolArgumentsSchema = z.record(z.string(), z.json());

/** Pi content used to derive tool arguments. */
export type ParakeetAssistantPart = Extract<
  SessionMessage["value"],
  { role: "assistant" }
>["content"][number];
/**
 * Pi's JSON argument object after the maintained Zod boundary parser.
 * @useDeclaredType
 */
export type ToolArguments = Extract<
  ParakeetAssistantPart,
  { type: "toolCall" }
>["arguments"];
