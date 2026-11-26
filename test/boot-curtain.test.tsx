// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { BootCurtain } from "../src/components/BootCurtain.js";
import { BootFailure } from "../src/components/BootFailure.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();
afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount();
    });
  }
  roots.clear();
  document.body.replaceChildren();
});

function mount(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(node);
  });
  return container;
}

it("is one labelled status with the step's copy and the mascot", () => {
  const container = mount(<BootCurtain message="Signing you in" />);
  const curtain = container.querySelectorAll("[data-boot-curtain]");
  expect(curtain).toHaveLength(1);
  expect(curtain[0]?.getAttribute("role")).toBe("status");
  expect(curtain[0]?.textContent).toBe("Signing you in");
  expect(container.querySelector(".boot-curtain-face")).not.toBeNull();
});

it("changes its copy in place, so a later step is the same curtain", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(<BootCurtain message="Signing you in" />);
  });
  const before = container.querySelector("[data-boot-curtain]");
  act(() => {
    root.render(<BootCurtain message="Setting up your Team" />);
  });
  expect(container.querySelector("[data-boot-curtain]")).toBe(before);
  expect(before?.textContent).toBe("Setting up your Team");
});

it("holds a fixed-size stage with the Caps Loader and draws no stand-in; the live face fades in once ready", () => {
  const container = mount(<BootCurtain message="Signing you in" />);
  const stage = container.querySelector(".boot-curtain-stage");
  expect(stage).not.toBeNull();
  // Only the live Sprite is ever in the stage: no hand-made SVG face.
  expect(stage?.querySelector(".boot-curtain-standin")).toBeNull();
  expect(stage?.querySelector(".boot-curtain-live svg")).toBeNull();
  // The Caps Loader holds the stage, decorative, until the live face is ready.
  const loader = stage?.querySelector(".caps-loader");
  expect(loader).not.toBeNull();
  expect(loader?.getAttribute("aria-hidden")).toBe("true");
  const live = container.querySelector(".boot-curtain-live");
  expect(live).not.toBeNull();
  // Hidden until Sprite reports ready (jsdom never reaches ready).
  expect(live?.hasAttribute("data-ready")).toBe(false);
});

it("shows a boot failure as an alert with the cause, a reference and its actions", () => {
  const container = mount(
    <BootFailure
      message="Your desktop didn't load: the Hub answered 503"
      reference="req_1"
    >
      <button type="button">Reload</button>
    </BootFailure>,
  );
  const failure = container.querySelector("[data-boot-failure]");
  expect(failure?.getAttribute("role")).toBe("alert");
  expect(failure?.textContent).toContain("the Hub answered 503");
  expect(failure?.textContent).toContain("Ref req_1");
  expect(failure?.querySelector("button")?.textContent).toBe("Reload");
  expect(container.querySelector("[data-boot-curtain]")).toBeNull();
});
