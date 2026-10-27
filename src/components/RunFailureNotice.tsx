import { Alert } from "@fungi.computer/caps/components/alert";
import { Button } from "@fungi.computer/caps/components/button";
import { boundedDiagnostic } from "@fungi.computer/bird-dog/effect";
import type { ComposerController } from "../conversation.js";

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
  return (
    <Alert
      tone="warning"
      title={failure === "cancelled" ? "Taking a breather" : "A little tangle"}
      description={
        interruptedWithReason ? (
          <>
            This turn stopped before it finished: {publicCause}. Your prompt is
            still here.
          </>
        ) : (
          <>
            {messages[failure]} If the model didn’t start, there’s no charge.
            Model work already done can still use credits.
            {publicCause ? <span className="block">{publicCause}</span> : null}
          </>
        )
      }
      action={
        failure === "cancelled" ? undefined : (
          <Button aria-label="Retry prompt" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}
