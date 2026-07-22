export default function AtgeirLogo({ className = "", width = 140 }: { className?: string; width?: number }) {
  return (
    <svg
      width={width}
      height={(width * 40) / 140}
      viewBox="0 0 140 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Bar chart icon */}
      <g>
        <rect x="2" y="28" width="6" height="10" fill="#F26522" />
        <rect x="10" y="20" width="6" height="18" fill="#F26522" />
        <rect x="18" y="12" width="6" height="26" fill="#F26522" />
        {/* Arrow */}
        <path
          d="M26 8 L32 2 L38 8 M32 2 L32 38"
          stroke="#F26522"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
      {/* Text "ATGEIR" */}
      <text
        x="48"
        y="28"
        fontFamily="var(--font-poppins)"
        fontSize="20"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="-0.5"
      >
        ATGEIR
      </text>
    </svg>
  );
}
