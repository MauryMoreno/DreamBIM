// Texture image: it is read from the disk and shrunk so the library does not grow too much.
import { fitSize } from '../platform/image-size';

/** Maximum side, in pixels, of the image that is stored. */
export const TEXTURE_MAX_SIDE = 1024;

/**
 * Lee un archivo de imagen y devuelve un data URI JPEG reducido (se pierde la transparencia: queda sobre
 * blanco). Lanza si el archivo no se puede leer o no es una imagen.
 */
export async function readTextureFile(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That file is not an image'));
    i.src = url;
  });
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, TEXTURE_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
