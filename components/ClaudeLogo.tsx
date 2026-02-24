interface AnvilLogoProps {
  size?: number;
  className?: string;
}

export function AnvilLogo({ size = 24, className = "" }: AnvilLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      fill="none"
    >
      {/* Anvil body — cartoon style */}
      {/* Horn (pointed left side) */}
      <path
        d="M8 32 C8 30, 12 28, 18 28 L18 36 C12 36, 8 34, 8 32Z"
        fill="currentColor"
        opacity="0.85"
      />
      {/* Top face (flat working surface) */}
      <rect x="18" y="24" width="30" height="12" rx="2" fill="currentColor" />
      {/* Highlight on top face */}
      <rect x="20" y="26" width="26" height="3" rx="1" fill="currentColor" opacity="0.3" />
      {/* Neck (narrower middle section) */}
      <rect x="22" y="36" width="22" height="6" rx="1" fill="currentColor" opacity="0.75" />
      {/* Base (wide bottom) */}
      <path
        d="M14 42 L52 42 L56 52 C56 54, 54 56, 52 56 L14 56 C12 56, 10 54, 10 52 Z"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Base highlight */}
      <path
        d="M18 44 L48 44 L50 48 L16 48 Z"
        fill="currentColor"
        opacity="0.2"
      />
      {/* Hardy hole (square hole on top) */}
      <rect x="40" y="25" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

// Keep backward-compatible export
export const ClaudeLogo = AnvilLogo;
