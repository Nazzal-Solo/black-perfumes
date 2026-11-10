export function BrandMark({ width = 180, height = 90 }: { width?: number; height?: number }) {
  return <span className="brand-fallback" role="img" aria-label="Black Perfumes" style={{ width, height, fontSize: Math.min(width / 7, 26) }}><span>BLACK</span><span>PERFUMES</span></span>;
}
