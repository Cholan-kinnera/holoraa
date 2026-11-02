/**
 * The Holoraa mark and logo. Plain <img> tags are used on purpose: next/image
 * adds an inline style attribute, which the nonce-only style-src policy blocks.
 * The files are static SVG in public/brand.
 */

/** The mark. It is decorative, because the adjacent text carries the name. */
export function BrandMark({ size = 28 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- next/image would emit an inline style blocked by CSP.
  return <img src="/brand/holoraa-mark.svg" alt="" width={size} height={size} className="brand__mark" />;
}

/** The full logo with the wordmark. Its name is the alt text. */
export function BrandLogo({ width = 160 }: { width?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see BrandMark.
    <img
      src="/brand/holoraa-logo.svg"
      alt="Holoraa"
      width={width}
      height={Math.round((width * 1420) / 1254)}
      className="brand-logo"
    />
  );
}
