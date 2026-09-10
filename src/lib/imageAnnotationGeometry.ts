export type ImageBounds = { left: number; top: number; width: number; height: number };

/** Visible pixels inside an object-fit: contain image, in client coordinates. */
export function containedImageBounds(box: ImageBounds, naturalWidth: number, naturalHeight: number): ImageBounds | null {
  if (![box.left, box.top, box.width, box.height, naturalWidth, naturalHeight].every(Number.isFinite)) return null;
  if (box.width <= 0 || box.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** Drawing starts only on image pixels; captured moves may clamp to its edge. */
export function imageAnnotationPoint(bounds: ImageBounds | null, clientX: number, clientY: number, clampOutside = false): { x: number; y: number } | null {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const x = (clientX - bounds.left) / bounds.width;
  const y = (clientY - bounds.top) / bounds.height;
  if (!clampOutside && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
