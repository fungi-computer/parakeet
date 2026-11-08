import { SetupNotice } from "@fungi.computer/caps/blocks/setup-notice";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { boundedDiagnostic } from "@fungi.computer/bird-dog/effect";
import { useContext } from "react";
import type { ComposerController } from "../conversation.js";
import { ParakeetHostFactsContext } from "../host-facts.js";

const messages = {
  admission: "Your prompt didn’t make it through. Let’s give it another go.",
  failed: "The run stopped. Check the message above before trying again.",
  interrupted:
    "The worker stopped before this run finished. Your prompt is still here.",
  cancelled: "The run was cancelled. Send a new prompt when you’re ready.",
} satisfies Record<NonNullable<ComposerController["failure"]>, string>;

/** Session failures do not carry a billing receipt; never promise a refund. */
export function RunFailureNotice({
  failure,
  cause,
  onRetry,
}: Readonly<{
  failure: NonNullable<ComposerController["failure"]>;
  cause?: string | undefined;
  onRetry: () => void;
}>) {
  const { billing = true, modelSetup } = useContext(ParakeetHostFactsContext);
  // With no model connected the timeline already says so, once, with the fix.
  if (failure === "failed" && modelSetup?.state === "missing") return null;
  if (failure === "admission" && modelSetup?.state === "missing")
    return (
      <SetupNotice
        cause="No model is connected to this workspace."
        fix={modelSetup.fix}
        need="No model could answer"
        variant="inline"
      />
    );
  const bounded = cause === undefined ? undefined : boundedDiagnostic(cause);
  // Diagnostic metadata is useful to the owner, not a public explanation.
  const publicCause =
    bounded !== undefined &&
    !bounded.startsWith("reason_unavailable:") &&
    !/\b(?:run|session)=/iu.test(bounded)
      ? bounded
      : undefined;
  const interruptedWithReason =
    failure === "interrupted" && publicCause !== undefined;
  const credits = billing
    ? " If the model didn’t start, there’s no charge. Model work already done can still use credits."
    : "";
  const message = interruptedWithReason
    ? `This turn stopped before it finished: ${publicCause}. Your prompt is still here.`
    : `${messages[failure]}${credits}${publicCause ? ` ${publicCause}` : ""}`;
  return (
    <FailureLine
      message={message}
      role="alert"
      {...(failure === "cancelled"
        ? {}
        : { onRetry, retryAriaLabel: "Retry prompt" })}
    />
  );
}
