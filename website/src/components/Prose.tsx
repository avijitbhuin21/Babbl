import React from "react";

export const Prose: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="max-w-[68ch] text-[15px] leading-[1.75] text-text/60 [&_a]:text-accent [&_a:hover]:underline [&_code]:rounded [&_code]:border [&_code]:border-border/50 [&_code]:bg-surface/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-text/80 [&_h2]:mt-14 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-text [&_h3]:mt-9 [&_h3]:text-[16px] [&_h3]:font-medium [&_h3]:text-text/90 [&_li]:mt-2 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5">
    {children}
  </div>
);
