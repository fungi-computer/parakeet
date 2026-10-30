import { createRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Display } from "@fungi.computer/caps/components/surface";
import { ChatComposer } from "../../src/components/ChatComposer.js";
import type { ComposerController } from "../../src/conversation.js";

const root = document.querySelector<HTMLElement>("#root");
if (root === null) throw new Error("composer material fixture root is missing");

function KeyboardComposerFixture() {
  const [draft, setDraft] = useState("");
  const [sends, setSends] = useState(0);
  const [images, setImages] = useState<ComposerController["images"]>([]);
  return (
    <section data-testid="keyboard-composer">
      <ChatComposer
        queuedRecall={{
          images,
          recallState: { kind: "idle" },
          recall: () => Promise.resolve("empty"),
        }}
        onImagesChange={setImages}
        draft={draft}
        failure={undefined}
        onAbort={() => undefined}
        onChange={setDraft}
        onRetry={() => undefined}
        onSend={() => {
          setSends((count) => count + 1);
        }}
        viewState={{ kind: "idle" }}
        status="idle"
        textareaRef={createRef<HTMLTextAreaElement>()}
      />
      <output data-testid="send-count">{sends}</output>
    </section>
  );
}

createRoot(root).render(
  <>
    <main className="flex h-screen flex-col gap-md bg-base-200 p-lg">
      <Display fit="fill" size="lg">
        <div className="grid gap-md p-lg">
          <p className="message-body">
            Reply with exactly: Grove demo complete.
          </p>
          <code className="font-mono text-xs">0.3K · $0.00</code>
        </div>
      </Display>
      <ChatComposer
        queuedRecall={undefined}
        draft=""
        failure={undefined}
        model={{
          model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
          provider: "cloudflare-workers-ai",
        }}
        statusChips={["Connected to this Agent"]}
        onImagesChange={() => undefined}
        onAbort={() => undefined}
        onChange={() => undefined}
        onRetry={() => undefined}
        onSend={() => undefined}
        viewState={{ kind: "waiting_for_you" }}
        status="thinking"
        textareaRef={createRef<HTMLTextAreaElement>()}
        usage={{ cost: 0, tokens: 300 }}
        context={{ tokens: 12_345, window: 200_000 }}
      />
    </main>
    <KeyboardComposerFixture />
  </>,
);
