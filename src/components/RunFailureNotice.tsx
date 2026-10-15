import { Alert } from "@fungi.computer/caps/components/alert";
import { Button } from "@fungi.computer/caps/components/button";
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
  return (
    <Alert
      tone="warning"
      title={failure === "cancelled" ? "Taking a breather" : "A little tangle"}
      description={
        <>
          {messages[failure]} If the model didn’t start, there’s no charge.
          Model work already done can still use credits.
          {cause ? <span className="block">{cause}</span> : null}
        </>
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
