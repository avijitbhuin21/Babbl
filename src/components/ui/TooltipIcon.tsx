import React from "react";

interface TooltipIconProps {
    onClick?: () => void;
    onKeyDown?: (e: React.KeyboardEvent<SVGSVGElement>) => void;
}

export const TooltipIcon: React.FC<TooltipIconProps> = ({
    onClick,
    onKeyDown,
}) => {
    return (
        <svg
            className="w-4 h-4 text-mid-gray cursor-help hover:text-background-ui transition-colors duration-200 select-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-label="More information"
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={onKeyDown}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        </svg>
    );
};
