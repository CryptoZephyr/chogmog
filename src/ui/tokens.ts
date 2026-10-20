export const colour = {
  ink: '#111419',
  inkSoft: '#55585F',
  line: '#CFD1D5',
  panel: '#FCFDFF',
  stage: '#F5F7F9',
  stageGrid: '#E3E7EA',
  wall: '#B3EDAC',
  blush: '#EF4992',
  blushPress: '#DA3380',
  focus: '#135AE4',
  caption: '#FFE967',
  tape: '#ECD8B6',
  error: '#C9302D',
  success: '#1D7D3E',
} as const;
export type ColourToken = keyof typeof colour;

export interface Tone { bright: string; deep: string }
export const abilityTone = {
  lift: { bright: '#FFB129', deep: '#C65100' },
  portal: { bright: '#8E61FC', deep: '#6C38D2' },
} as const satisfies Record<string, Tone>;
const laserTones: Record<string, Tone> = {
  'fire laser': { bright: '#F65311', deep: '#C83500' },
  'Purple laser': { bright: '#A347EF', deep: '#8834CB' },
  'Green laser': { bright: '#31DA62', deep: '#008935' },
  'cyan laser': { bright: '#00DDEF', deep: '#00849C' },
};
export function laserTone(eyes: string | undefined): Tone | null {
  return (eyes && laserTones[eyes]) || null;
}

/** Hex values picked from each Background in the Genesis artwork. Unknown values use the fallback wall. */
export const BACKGROUND_SWATCH: Readonly<Record<string, string>> = {
  'Fresh Green': '#B3EDAC',
  'Coral Pink': '#F7A79B',
};

export const hexToNumber = (hex: string) => Number.parseInt(hex.slice(1), 16);

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface Oklch { l: number; c: number; h: number }
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
function oklchToLinear({ l: L, c, h }: Oklch): number[] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
export function oklchToHex(colourValue: Oklch): string {
  let { c } = colourValue;
  let rgb = oklchToLinear({ ...colourValue, c });
  for (let low = 0, high = c, i = 0; !inGamut(rgb) && i < 24; i++) {
    c = (low + high) / 2;
    rgb = oklchToLinear({ ...colourValue, c });
    if (inGamut(rgb)) low = c; else high = c;
    if (i === 23) rgb = oklchToLinear({ ...colourValue, c: low });
  }
  return `#${rgb.map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export const WALL_LIGHTNESS = [0.86, 0.92] as const;
export const WALL_MAX_CHROMA = 0.13;
export function clampWall(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return oklchToHex({ l: Math.min(WALL_LIGHTNESS[1], Math.max(WALL_LIGHTNESS[0], l)), c: Math.min(WALL_MAX_CHROMA, c), h });
}
export function wallFor(background: string | undefined): string {
  const swatch = background ? BACKGROUND_SWATCH[background] : undefined;
  return clampWall(swatch ?? colour.wall);
}

const cssName = (token: string) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
export function applyCssVariables(root: HTMLElement): void {
  for (const [token, value] of Object.entries(colour)) root.style.setProperty(cssName(token), value);
  root.style.setProperty('--lift', abilityTone.lift.deep);
  root.style.setProperty('--portal', abilityTone.portal.deep);
}

export const pixiTheme = {
  ...(Object.fromEntries(Object.entries(colour).map(([k, v]) => [k, hexToNumber(v)])) as Record<ColourToken, number>),
  white: 0xffffff,
} as const;
export type PixiTheme = typeof pixiTheme;

export const fontFamily = {
  display: '"Dela Gothic One", "Arial Black", sans-serif',
  ui: '"Atkinson Hyperlegible Next", system-ui, sans-serif',
  mono: '"Atkinson Hyperlegible Mono", ui-monospace, monospace',
} as const;
export async function loadFonts(timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = Promise.all(['400 16px "Dela Gothic One"', '400 16px "Atkinson Hyperlegible Next"', '700 16px "Atkinson Hyperlegible Next"',
    '400 16px "Atkinson Hyperlegible Mono"', '600 16px "Atkinson Hyperlegible Mono"'].map((font) => document.fonts.load(font)));
  await Promise.race([loads.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
