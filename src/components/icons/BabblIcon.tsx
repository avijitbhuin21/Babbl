import React from "react";

interface BabblIconProps {
    width?: number | string;
    height?: number | string;
    className?: string;
}

const BabblIcon: React.FC<BabblIconProps> = ({ width = 24, height = 24, className }) => {
    return (
        <img
            src="/src-tauri/resources/tray_idle.png"
            width={width}
            height={height}
            className={className}
            alt="Babbl"
            style={{ objectFit: "contain" }}
        />
    );
};

export default BabblIcon;
