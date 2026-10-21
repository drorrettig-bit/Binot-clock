/* eslint-disable @next/next/no-img-element */

/** לוגו הישיבה על רקע שקוף. במצב כהה מוצגת גרסה שבה הסגול מואר, כדי שהספר ייראה. */
export function Logo({ height, className }: { height: number; className?: string }) {
  const width = Math.round((height * 473) / 267);
  return (
    <picture className={className}>
      <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
      <img src="/logo-light.png" alt="ישיבת ההסדר בינות רעננה" width={width} height={height} style={{ display: "block", height, width: "auto", maxWidth: "100%" }} />
    </picture>
  );
}
