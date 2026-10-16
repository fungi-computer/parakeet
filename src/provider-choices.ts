import type { WhistlePrompt } from "@fungi.computer/whistle";
import type { LoginProvider, ProviderAccess } from "./account-commands.js";

/** Whistle-owned choice options returned by the provider grouping helper. */
export type ChoiceOptions = Extract<
  WhistlePrompt,
  { type: "choice" }
>["options"];

/** Group the existing registry or model providers without owning another catalog. */
export function providerChoices(
  providers: readonly LoginProvider[],
  access: readonly ProviderAccess[],
  popularProviderIds: readonly string[],
  screen: "login" | "model",
): ChoiceOptions {
  const signedIn = new Map(
    access.map((provider) => [provider.providerId, provider]),
  );
  const popular = new Map(popularProviderIds.map((id, index) => [id, index]));
  const group = (id: string) =>
    signedIn.has(id) ? 0 : screen === "login" && popular.has(id) ? 1 : 2;
  const isDefault = (id: string) => screen === "model" && id === "fungi";
  return [
    ...new Map(providers.map((provider) => [provider.id, provider])).values(),
  ]
    .sort(
      (left, right) =>
        Number(isDefault(right.id)) - Number(isDefault(left.id)) ||
        group(left.id) - group(right.id) ||
        (group(left.id) < 2
          ? (popular.get(left.id) ?? popularProviderIds.length) -
            (popular.get(right.id) ?? popularProviderIds.length)
          : 0) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
    .map((provider) => {
      const methods = provider.methods.map((method) =>
        method.kind === "api_key" ? "API key" : "Subscription",
      );
      const credential = signedIn.get(provider.id);
      // Fungi's sign-in is the Fungi account; its Team pays, not a subscription.
      const description =
        provider.id === "fungi"
          ? "Fungi account"
          : methods.length > 0
            ? methods.join(" or ")
            : credential?.type === "oauth"
              ? "Subscription"
              : credential?.type === "api_key"
                ? "API key"
                : undefined;
      const choice: ChoiceOptions[number] = {
        value: provider.id,
        label: provider.name,
        group:
          isDefault(provider.id) && !signedIn.has(provider.id)
            ? "Default"
            : group(provider.id) === 0
              ? "Signed in"
              : group(provider.id) === 1
                ? "Popular"
                : "More providers",
      };
      if (description === undefined) return choice;
      return { ...choice, description };
    });
}
