import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "font-medium rounded-lg border focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

  const variantClasses = {
    primary:
      "text-white bg-background-ui border-background-ui hover:bg-background-ui/90 hover:shadow-md focus:ring-2 focus:ring-background-ui/50",
    secondary:
      "bg-surface border-border hover:bg-background-ui/15 hover:border-background-ui focus:ring-2 focus:ring-background-ui/30",
    danger:
      "text-white bg-red-600 border-red-600 hover:bg-red-700 hover:border-red-700 focus:ring-2 focus:ring-red-500/50",
    ghost:
      "text-current border-transparent hover:bg-background-ui/10 hover:border-background-ui/30 focus:bg-background-ui/15",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-[5px] text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
