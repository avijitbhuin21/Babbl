import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div className="space-y-3 w-full">
      {title && (
        <div className="px-1">
          <h2 className="text-xs font-semibold text-text/50 uppercase tracking-wider">
            {title}
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
