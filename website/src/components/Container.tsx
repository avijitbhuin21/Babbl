import React from "react";

export const Container: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div className={`mx-auto w-full max-w-[1100px] px-6 md:px-8 ${className}`}>{children}</div>
);
