import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "danger";

const VARIANT_CLASS: Record<Variant, string> = {
  default: "btn",
  primary: "btn pri",
  danger: "btn dng",
};

export function Button({
  variant = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const classes = className ? `${VARIANT_CLASS[variant]} ${className}` : VARIANT_CLASS[variant];
  return <button type={type} className={classes} {...props} />;
}
