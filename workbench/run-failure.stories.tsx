import type { StoryDefault } from "@ladle/react";
import { createRef, useState } from "react";
import { ChatComposer } from "../src/components/ChatComposer.js";
import type { ComposerController } from "../src/conversation.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / Run failure" } satisfies StoryDefault;

function FailureStory({
  failure,
}: Readonly<{
  failure: NonNullable<ComposerController["failure"]>;
}>) {
  const [retried, setRetried] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <div className="mx-auto max-w-[42rem] p-md">
      <ChatComposer
        queuedRecall={undefined}
        draft={draft}
        failure={retried ? undefined : failure}
        status={retried ? "sending" : "error"}
        viewState={
          retried
            ? { kind: "idle" }
            : { kind: "error", cause: "Run did not complete" }
        }
        onAbort={() => {
          setRetried(false);
        }}
        onChange={setDraft}
        onRetry={() => {
          setRetried(true);
        }}
        onSend={() => {
          setRetried(true);
        }}
        textareaRef={createRef<HTMLTextAreaElement>()}
      />
    </div>
  );
}

export const Failed = () => <FailureStory failure="failed" />;
export const Admission = () => <FailureStory failure="admission" />;
export const Interrupted = () => <FailureStory failure="interrupted" />;
