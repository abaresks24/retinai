/**
 * Big legible star rating. `value` is in stars (0..5, e.g. score/20). Renders 5 glyphs
 * with the filled count = round(value). Size variants for the directory vs hero screens.
 */
export function Stars({
  value,
  size = "md",
}: {
  value: number;
  size?: "md" | "big" | "huge";
}) {
  const filled = Math.round(Math.max(0, Math.min(5, value)));
  const cls = size === "md" ? "stars" : `stars ${size}`;
  return (
    <span className={cls} aria-label={`${value.toFixed(1)} of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`s${i < filled ? " on" : ""}`}>
          ★
        </span>
      ))}
    </span>
  );
}
