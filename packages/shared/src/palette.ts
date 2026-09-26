/** Default series colours, assigned round-robin to new gutnumbers. Legible in light, dark and eink themes. */
export const PALETTE = ['#2f6fdf', '#e4572e', '#17a589', '#a05cc8', '#e0a100', '#d6336c', '#3d8b37', '#6c757d', '#0b7285', '#8a5a44'];

export function paletteColor(i: number): string {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
