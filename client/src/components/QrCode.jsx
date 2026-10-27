import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A QR code drawn as inline SVG, ported from gameboystudio's InvitePanel. SVG
 * scales cleanly to a TV and needs no canvas or image request.
 *
 * Type 0 lets the encoder pick the smallest version that fits, and error
 * correction L keeps the modules large: a code on a screen can always be
 * rescanned, so there is nothing to gain from damage tolerance.
 */
const QUIET_ZONE = 4;

export function QrCode({ value, label = 'Scan to join', className = '' }) {
  const { d, count } = useMemo(() => {
    const qr = qrcode(0, 'L');
    qr.addData(value);
    qr.make();
    const size = qr.getModuleCount();
    const parts = [];
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if (qr.isDark(row, column)) parts.push(`M${column} ${row}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), count: size };
  }, [value]);

  const full = count + QUIET_ZONE * 2;
  return (
    <svg
      // The quiet zone is part of the symbol; without it scanners hunt.
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${full} ${full}`}
      className={className}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={full} height={full} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
