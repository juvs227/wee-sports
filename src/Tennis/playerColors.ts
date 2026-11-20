export type ColorInput = number | string;

export const PLAYER_COLOR_PALETTE: number[] = [
  0x3b82f6, // blue
  0xef4444, // red
  0x22c55e, // green
  0xf59e0b, // amber
  0xa855f7, // purple
  0x06b6d4, // cyan
  0xf97316, // orange
  0xec4899, // pink
];

export function toRgb(color: ColorInput): [number, number, number] {
  if (typeof color === 'number') {
    if (!Number.isFinite(color) || color < 0 || color > 0xffffff) {
      throw new Error(`Invalid RGB color number: ${color}`);
    }
    const hex = Math.trunc(color);
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  }

  const normalized = color.replace(/^#/, '').trim();
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    throw new Error(`Invalid hex color: ${color}`);
  }

  const num = Number.parseInt(fullHex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Redmean RGB distance (~0 to ~765). Higher values mean more visually distinct colors.
 */
export function colorDistance(colorA: ColorInput, colorB: ColorInput): number {
  const [r1, g1, b1] = toRgb(colorA);
  const [r2, g2, b2] = toRgb(colorB);

  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;

  const weightR = 2 + rMean / 256;
  const weightG = 4;
  const weightB = 2 + (255 - rMean) / 256;

  return Math.sqrt(weightR * dr * dr + weightG * dg * dg + weightB * db * db);
}

export function areColorsTooSimilar(
  colorA: ColorInput,
  colorB: ColorInput,
  minDistance = 140,
): boolean {
  return colorDistance(colorA, colorB) < minDistance;
}

export function pickFallbackColor(
  desiredColor: number,
  otherColor: number,
  palette: number[] = PLAYER_COLOR_PALETTE,
  minDistance = 140,
): number {
  if (!areColorsTooSimilar(desiredColor, otherColor, minDistance)) {
    return desiredColor;
  }

  const shuffled = [...palette];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  let bestColor = desiredColor;
  let bestDistance = colorDistance(desiredColor, otherColor);

  for (const candidate of shuffled) {
    if (!areColorsTooSimilar(candidate, otherColor, minDistance)) {
      return candidate;
    }
    const dist = colorDistance(candidate, otherColor);
    if (dist > bestDistance) {
      bestDistance = dist;
      bestColor = candidate;
    }
  }

  return bestColor;
}