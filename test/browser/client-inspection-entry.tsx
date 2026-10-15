import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Parakeet } from "../../src/index.js";
import { inspectionFixture } from "../fixtures/inspection.fixture.js";
const fixture = inspectionFixture();
const root = document.getElementById("root");
if (root === null) throw new Error("Missing inspection proof root");
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <Parakeet session={fixture.session} clients={fixture.clients} />
  </QueryClientProvider>,
);
