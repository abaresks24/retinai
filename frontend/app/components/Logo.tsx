/* eslint-disable @next/next/no-img-element */
/**
 * RetinAI logomark — the iris (public/logo.svg). Square, transparent around the circle,
 * so it sits cleanly on the dark theme. Rendered as <img> because the SVG embeds a masked
 * raster; plain <img> renders the mask + image correctly and avoids next/image SVG config.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt="RetinAI"
      className={className}
      style={{ display: "block" }}
    />
  );
}
