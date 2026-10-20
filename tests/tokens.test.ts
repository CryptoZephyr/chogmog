import { describe, expect, it } from 'vitest';
import { abilityTone, BACKGROUND_SWATCH, clampWall, colour, contrast, hexToOklch, laserTone, wallFor, WALL_LIGHTNESS, WALL_MAX_CHROMA } from '../src/ui/tokens';

describe('design tokens', () => {
  it('keeps the recorded text contrast pairs at WCAG AA', () => {
    expect(contrast(colour.ink, colour.stage)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.ink, colour.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.inkSoft, colour.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.inkSoft, colour.stage)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.ink, colour.blush)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.ink, colour.caption)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.ink, colour.tape)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour.panel, colour.success)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps ability deep tones at the 3:1 graphics minimum on the stage', () => {
    const deep = [abilityTone.lift.deep, abilityTone.portal.deep, ...['fire laser', 'Purple laser', 'Green laser', 'cyan laser'].map((e) => laserTone(e)!.deep)];
    for (const tone of deep) expect(contrast(tone, colour.stage)).toBeGreaterThanOrEqual(3);
    expect(laserTone('Dead')).toBeNull();
  });

  it('clamps every Background swatch into the wall range with ink text readable', () => {
    for (const [name, swatch] of Object.entries(BACKGROUND_SWATCH)) {
      const wall = wallFor(name);
      const { l, c } = hexToOklch(wall);
      expect(l, name).toBeGreaterThanOrEqual(WALL_LIGHTNESS[0] - 0.005);
      expect(l, name).toBeLessThanOrEqual(WALL_LIGHTNESS[1] + 0.005);
      expect(c, name).toBeLessThanOrEqual(WALL_MAX_CHROMA + 0.005);
      expect(contrast(colour.ink, wall), `${name} ${swatch}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps ink readable on a clamped wall at every hue', () => {
    for (const hex of ['#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#8000FF', '#FF00FF', '#202020', '#FFFFFF']) {
      expect(contrast(colour.ink, clampWall(hex)), hex).toBeGreaterThanOrEqual(10);
    }
  });

  it('gives each sampled Background its own wall', () => {
    expect(Object.keys(BACKGROUND_SWATCH)).toHaveLength(16);
    expect(new Set(Object.keys(BACKGROUND_SWATCH).map(wallFor)).size).toBe(16);
  });

  it('uses the lime fallback for unknown, missing or unsampled Background values', () => {
    expect(wallFor(undefined)).toBe(wallFor('Not a real background'));
    for (const name of ['Lemon', 'Lemon Yellow', 'Light Purple', 'Lime Green', 'Deep Purple', 'Red Sky']) expect(wallFor(name), name).toBe(wallFor(undefined));
    expect(contrast(colour.ink, wallFor(undefined))).toBeGreaterThanOrEqual(10);
  });
});
