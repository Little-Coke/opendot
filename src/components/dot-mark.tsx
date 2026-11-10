import type { DotShape } from "@/lib/dot-profile";

export function DotMark({
  shape,
  color,
  size = 22,
}: {
  shape: DotShape;
  color: string;
  size?: number;
}) {
  const eye = "#143024";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {shape === "circle" ? <circle cx="24" cy="24" r="18" fill={color} /> : null}
      {shape === "rounded" ? <rect x="6" y="6" width="36" height="36" rx="14" fill={color} /> : null}
      {shape === "square" ? <rect x="7" y="7" width="34" height="34" rx="6" fill={color} /> : null}
      {shape === "diamond" ? <polygon points="24,4 44,24 24,44 4,24" fill={color} /> : null}
      {shape === "hexagon" ? <polygon points="24,4 42,14 42,34 24,44 6,34 6,14" fill={color} /> : null}
      <circle cx="18" cy="23" r="2.2" fill={eye} />
      <circle cx="30" cy="23" r="2.2" fill={eye} />
    </svg>
  );
}
