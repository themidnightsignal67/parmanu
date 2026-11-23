interface IndianFlagProps {
  className?: string;
}

export function IndianFlag({ className = 'w-5 h-3.5' }: IndianFlagProps) {
  return (
    <svg
      viewBox="0 0 36 24"
      className={`${className} rounded-[2px] ring-1 ring-slate-900/10 shrink-0 shadow-2xs`}
      role="img"
      aria-label="Flag of India"
    >
      {/* Top Horizontal Band: India Saffron */}
      <rect x="0" y="0" width="36" height="8" fill="#FF9933" />
      {/* Middle Horizontal Band: White */}
      <rect x="0" y="8" width="36" height="8" fill="#FFFFFF" />
      {/* Bottom Horizontal Band: India Green */}
      <rect x="0" y="16" width="36" height="8" fill="#138808" />
      {/* Ashoka Chakra (Navy Blue) */}
      <circle
        cx="18"
        cy="12"
        r="3.1"
        fill="none"
        stroke="#000080"
        strokeWidth="0.7"
      />
      <circle cx="18" cy="12" r="0.6" fill="#000080" />
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 15 * Math.PI) / 180;
        const dx = Math.cos(angle) * 2.8;
        const dy = Math.sin(angle) * 2.8;
        return (
          <line
            key={i}
            x1={18 - dx}
            y1={12 - dy}
            x2={18 + dx}
            y2={12 + dy}
            stroke="#000080"
            strokeWidth="0.32"
          />
        );
      })}
    </svg>
  );
}
