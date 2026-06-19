// The single PDF-point <-> screen-px mapping. The page is sized directly (width =
// points * scale); there is NO CSS transform:scale on the page, so screen px and the
// textarea overlay share one coordinate space (this is what made the prototype's caret
// unstable — fixed here by never scaling via transform).
export const ptToPx = (v: number, scale: number): number => v * scale;
export const pxToPt = (v: number, scale: number): number => v / scale;

export interface ScreenRect { left: number; top: number; width: number; height: number; }

export function blockScreenRect(
  b: { x: number; y: number; width: number; height: number },
  scale: number,
): ScreenRect {
  return { left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale };
}
