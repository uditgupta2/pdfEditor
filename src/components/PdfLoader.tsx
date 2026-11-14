export interface PdfLoaderProps {
  /** Text under the spinner. Pass `null` to hide it. */
  label?: string | null;
  /** Diameter in px. Default 64. */
  size?: number;
  className?: string;
}

/**
 * The default loading indicator: a document whose lines write themselves,
 * inside a rotating gradient ring. Uses the theme's accent colour and stays
 * still for users who prefer reduced motion.
 */
export function PdfLoader({ label = 'Loading…', size = 64, className }: PdfLoaderProps) {
  return (
    <div className={`rpe-loader${className ? ` ${className}` : ''}`} role="status" aria-live="polite">
      <div className="rpe-loader-mark" style={{ width: size, height: size }} aria-hidden="true">
        <span className="rpe-loader-ring" />
        <svg className="rpe-loader-doc" viewBox="0 0 32 40" width={size * 0.42} height={size * 0.52}>
          <path className="rpe-loader-sheet" d="M3 1h18l8 8v28a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" />
          <path className="rpe-loader-fold" d="M21 1v8h8" />
          <line className="rpe-loader-line" x1="7" y1="17" x2="25" y2="17" />
          <line className="rpe-loader-line" x1="7" y1="23" x2="25" y2="23" />
          <line className="rpe-loader-line" x1="7" y1="29" x2="18" y2="29" />
        </svg>
      </div>
      {label && <span className="rpe-loader-label">{label}</span>}
    </div>
  );
}
