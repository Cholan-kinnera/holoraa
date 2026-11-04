/**
 * Branding component for Holoraa.
 *
 * The official Holoraa logo will be provided separately.
 * In accordance with project instructions:
 * - No logo is generated or invented.
 * - Logo placement is reserved with appropriate sizing.
 * - A clean, understated text label is used.
 */

export function BrandMark({ className = "" }: { size?: number; className?: string } = {}) {
  return (
    <span className={`brand-mark-reserved ${className}`} aria-hidden="true">
      <span className="brand-mark-text">h</span>
    </span>
  );
}




export function BrandLogo({ className = "" }: { className?: string; width?: number }) {
  return (
    <span className={`brand-logo-reserved font-semibold tracking-tight text-white font-sans ${className}`}>
      holoraa
    </span>
  );
}
