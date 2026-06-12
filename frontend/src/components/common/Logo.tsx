import React from "react";

interface LogoProps {
  size?: number;
  variant?: "full" | "icon";
  textColor?: string;
  className?: string;
}

export default function Logo({
  size = 32,
  variant = "full",
  textColor = "var(--ent-text, #183153)",
  className = "",
}: LogoProps) {
  const iconSize = size;
  const fontSize = size * 0.58; // 动态计算字号，使文字大小随图标大小自适应

  return (
    <div
      className={`mtemphub-logo ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: `${size * 0.3}px`,
        textDecoration: "none",
        userSelect: "none",
        verticalAlign: "middle",
      }}
    >
      <svg
        className="logo-icon-svg"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 128 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          flexShrink: 0,
          transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <defs>
          <linearGradient id="logoReactGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4F46E5" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
          <filter id="logoGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#4F46E5" floodOpacity="0.25" />
          </filter>
        </defs>
        <g filter="url(#logoGlow)" className="logo-paths-group">
          <path
            d="M 28 94 V 46 C 28 34 38 24 50 24 C 62 24 72 34 72 46 V 78"
            stroke="url(#logoReactGrad)"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 56 50 V 82 C 56 94 66 104 78 104 C 90 104 100 94 100 82 V 34"
            stroke="url(#logoReactGrad)"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            className="logo-center-dot"
            cx="64"
            cy="64"
            r="10"
            fill="#FFFFFF"
            stroke="url(#logoReactGrad)"
            strokeWidth="5"
            style={{
              transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), fill 0.3s ease",
              transformOrigin: "64px 64px",
            }}
          />
        </g>
      </svg>
      {variant === "full" && (
        <span
          className="logo-text"
          style={{
            color: textColor,
            fontSize: `${fontSize}px`,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            letterSpacing: "-0.015em",
            fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
            transition: "color 0.2s ease",
          }}
        >
          <span style={{ fontWeight: 800 }}>MT</span>
          <span style={{ fontWeight: 500, opacity: 0.95, marginLeft: "1px" }}>EmpHub</span>
        </span>
      )}
    </div>
  );
}
