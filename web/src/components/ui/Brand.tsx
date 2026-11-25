/* eslint-disable @next/next/no-img-element -- small static brand PNGs, served as-is. */

/**
 * Holoraa brand. Assets in public/brand are lifted from the official logo
 * (ref/logo-source.png) onto a transparent background. They are made for
 * the dark theme: the glow reads as haze on light backgrounds.
 */

const MARK = { src: "/brand/holoraa-mark.png", width: 160, height: 136 };
const WORDMARK = { src: "/brand/holoraa-wordmark.png", width: 480, height: 109 };

/** The symbol alone. Decorative: pair it with text or a labelled link. */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string } = {}) {
  return (
    <img
      src={MARK.src}
      alt=""
      aria-hidden="true"
      width={Math.round((size * MARK.width) / MARK.height)}
      height={size}
      className={`brand-mark ${className}`}
      decoding="async"
    />
  );
}

/** Symbol and wordmark side by side. Its accessible name is "Holoraa". */
export function BrandLogo({ size = 28, className = "" }: { size?: number; className?: string } = {}) {
  const wordHeight = Math.round(size * 0.62);
  return (
    <span className={`brand-logo-lockup ${className}`}>
      <BrandMark size={size} />
      <img
        src={WORDMARK.src}
        alt="Holoraa"
        width={Math.round((wordHeight * WORDMARK.width) / WORDMARK.height)}
        height={wordHeight}
        className="brand-logo-lockup__word"
        decoding="async"
      />
    </span>
  );
}
