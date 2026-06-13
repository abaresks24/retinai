/**
 * Lynx logomark — a minimal monoline lynx head (tufted ears + the sharp, discerning gaze).
 * Uses the brand gradient. Pure SVG, scales crisply; pass `size` to control it.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="url(#lynxGrad)"
      strokeWidth={3.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Lynx"
      role="img"
    >
      <defs>
        <linearGradient id="lynxGrad" x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c8cff" />
          <stop offset="1" stopColor="#b98bff" />
        </linearGradient>
      </defs>
      {/* tufted ears */}
      <path d="M18 27 L13 7 L27 19" />
      <path d="M46 27 L51 7 L37 19" />
      {/* jaw / face */}
      <path d="M18 27 C18 43 24 50 32 53 C40 50 46 43 46 27" />
      {/* sharp eyes */}
      <path d="M22 31 L28.5 29.5" />
      <path d="M42 31 L35.5 29.5" />
      {/* muzzle */}
      <path d="M32 39 L32 43" />
    </svg>
  );
}
