import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { Spinner } from "./icons";

// One button, three emphases, three sizes — so a view can make exactly one
// action dominant and let the rest recede. `primary` is the ink-filled CTA with
// an inset highlight; `secondary` is a hairline card; `ghost` is text-only.
// A leading icon gets the house tilt-and-grow on hover; `loading` swaps a spinner.
type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-ink text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.08),inset_0_1px_0_0_rgb(255_255_255/0.12)] " +
    "hover:bg-[#1c1c22] focus-visible:ring-ink/25",
  secondary:
    "border border-line bg-card text-ink-2 hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:ring-accent/30",
  ghost: "text-muted hover:bg-surface hover:text-ink focus-visible:ring-accent/30",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[14px]",
  md: "h-9 gap-1.5 rounded-lg px-3 text-[14.5px]",
  lg: "h-11 gap-2 rounded-[11px] px-5 text-[15.5px]",
};

export default function Button({
  className = "",
  icon,
  variant = "primary",
  size = "md",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      disabled={disabled || loading}
      className={
        "group inline-flex select-none items-center justify-center whitespace-nowrap font-medium outline-none " +
        "transition active:scale-[0.985] focus-visible:ring-2 " +
        "disabled:pointer-events-none disabled:opacity-50 " +
        SIZE[size] +
        " " +
        VARIANT[variant] +
        " " +
        className
      }
      {...props}
    >
      {(icon || loading) && (
        <span className="transition-transform duration-300 group-hover:rotate-[14deg] group-hover:scale-110">
          {loading ? <Spinner size={size === "lg" ? 15 : 12} /> : icon}
        </span>
      )}
      {children}
    </button>
  );
}
