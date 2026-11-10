export function BrandMark({ width = 180, height = 90, status }: { width?: number; height?: number; status?: string }) {
  return <span className="brand-fallback" data-branding-state={status} aria-busy={status === "loading" || undefined} role="img" aria-label="Black Perfumes" style={{ width, height, fontSize: Math.min(width / 7, 26) }}><span>BLACK</span><span>PERFUMES</span></span>;
}
