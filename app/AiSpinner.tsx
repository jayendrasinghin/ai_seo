import type { CSSProperties } from "react";

type AiSpinnerProps = {
  size?: number;
  /** default: blue accent; muted: gray; onDark: white arc */
  variant?: "default" | "muted" | "onDark";
  style?: CSSProperties;
  "aria-label"?: string;
  /** Hide from assistive tech when parent control has the label (e.g. button text). */
  "aria-hidden"?: boolean;
};

export function AiSpinner({
  size = 18,
  variant = "default",
  style,
  "aria-label": ariaLabel = "Loading",
  "aria-hidden": ariaHidden,
}: AiSpinnerProps) {
  const variantClass =
    variant === "muted"
      ? "ai-loading-spinner ai-loading-spinner--muted"
      : variant === "onDark"
        ? "ai-loading-spinner ai-loading-spinner--on-dark"
        : "ai-loading-spinner";

  return (
    <span
      className={variantClass}
      style={{ width: size, height: size, ...style }}
      role={ariaHidden ? undefined : "status"}
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden === true ? true : undefined}
    />
  );
}
