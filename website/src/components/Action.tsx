import React from "react";
import { Link } from "react-router-dom";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent border-accent text-background hover:bg-accent/90 hover:border-accent/90",
  secondary:
    "bg-surface/60 border-border/60 text-text hover:bg-accent/10 hover:border-accent/50",
  ghost: "border-transparent text-text/70 hover:text-text",
};

const sizes: Record<Size, string> = {
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-[15px]",
};

interface ActionProps {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  href?: string;
  to?: string;
  external?: boolean;
}

export const Action: React.FC<ActionProps> = ({
  children,
  variant = "primary",
  size = "md",
  className = "",
  href,
  to,
  external,
}) => {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      className={classes}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  );
};
