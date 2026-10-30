import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import {
  KeycapButton,
  type KeycapButtonProps,
} from "@fungi.computer/caps/components/keycap";
import { cn } from "@fungi.computer/caps/lib/cn";

/** A model label on the shared native key; callers own selection and menus. */
export type ComposerModelKeyProps = Omit<
  KeycapButtonProps,
  "icon" | "readout" | "label"
> & {
  /** Friendly catalog name, or the real model identity when no name is known. */
  label: string;
};

/** The same model face and chevron in chat and generation composers. */
export const ComposerModelKey = forwardRef<
  HTMLButtonElement,
  ComposerModelKeyProps
>(function ComposerModelKey({ className, label, ...props }, ref) {
  return (
    <KeycapButton
      {...props}
      ref={ref}
      className={cn("parakeet-composer-model-key", className)}
      label={label}
      readout={
        <ChevronDown
          aria-hidden="true"
          className="size-[var(--stipe-icon-size-sm)] shrink-0"
        />
      }
    />
  );
});
