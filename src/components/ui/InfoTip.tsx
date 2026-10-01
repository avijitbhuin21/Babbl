import React, { useEffect, useRef, useState } from "react";
import { TooltipIcon } from "./TooltipIcon";

/** "i" icon that shows `text` in a tooltip on hover or click (same look as SettingContainer). */
export const InfoTip: React.FC<{ text: string; position?: "top" | "bottom" }> = ({ text, position = "top" }) => {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!show) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [show]);

  return (
    <span
      ref={ref}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => {
        e.stopPropagation();
        setShow(!show);
      }}
    >
      <TooltipIcon
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setShow(!show);
          }
        }}
      />
      {show && (
        <span
          className={`absolute ${position === "top" ? "bottom-full mb-2" : "top-full mt-2"} left-1/2 -translate-x-1/2 px-3 py-2 bg-background border border-mid-gray/80 rounded-lg shadow-lg z-[300] w-64 whitespace-normal text-left animate-in fade-in-0 zoom-in-95 duration-200`}
        >
          <span className="block text-xs font-normal leading-relaxed text-text">{text}</span>
        </span>
      )}
    </span>
  );
};
