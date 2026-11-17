// Reduction of the captures sent to the agent: a big image costs context and time.
import { fitSize } from '../../platform/image-size';

/** Redraws a PNG (data URL) at a smaller size. It needs a real DOM: it is tested by hand in the app. */
export async function scaleDataUrl(
  dataUrl: string,
  w: number,
  h: number,
  max: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { width, height } = fitSize(w, h, max);
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not scale the screenshot');
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}
