import React from "react";
import { InfoTip } from "./InfoTip";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  info?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  info,
  children,
}) => {
  return (
    <div className="space-y-3 w-full">
      {title && (
        <div className="px-1">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-text/50 uppercase tracking-wider">
            {title}
            {info && <InfoTip text={info} position="bottom" />}
          </h2>
          {description && (
            <p className="text-xs text-text/40 mt-1">{description}</p>
          )}
        </div>
      )}
      <div className="bg-surface/50 rounded-xl overflow-visible">
        <div className="divide-y divide-border/30">{children}</div>
      </div>
    </div>
  );
};
