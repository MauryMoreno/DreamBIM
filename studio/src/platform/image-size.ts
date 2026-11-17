/** The size an image shrinks to so that its longest side is at most `max` (never enlarged, at least 1 px each way). */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
