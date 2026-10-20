import { abilityTone, colour, fontFamily, laserTone } from '../ui/tokens';
import { PREVIEWS } from '../domain/chog';

export type Ctx = CanvasRenderingContext2D;
export const uiFont = (size: number, weight = 700) => `${weight} ${size}px ${fontFamily.ui}`;
export const displayFont = (size: number) => `400 ${size}px ${fontFamily.display}`;

export function laserFor(tokenId: string | undefined) {
  const eyes = PREVIEWS.find((p) => p.tokenId === tokenId)?.metadata.attributes.find((t) => t.trait_type === 'Eyes')?.value;
  return laserTone(eyes) ?? laserTone('cyan laser')!;
}

export function board(ctx: Ctx, width: number, height: number, unit: number, floorY: number) {
  ctx.fillStyle = colour.stage; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colour.stageGrid; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.beginPath();
  for (let x = unit; x < width; x += unit) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, floorY); }
  for (let y = floorY - unit; y > 0; y -= unit) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
  ctx.fillStyle = colour.stageGrid; ctx.fillRect(0, floorY, width, height - floorY);
  ctx.strokeStyle = colour.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(width, floorY); ctx.stroke();
}

export function inkCircle(ctx: Ctx, x: number, y: number, r: number, fill: string = '#FFFFFF', stroke: string = colour.ink, width = 3) {
  ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
}

export function plank(ctx: Ctx, x: number, y: number, w: number, h: number, angle: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-angle);
  ctx.setLineDash([]);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = 'rgba(17, 20, 25, 0.12)'; ctx.fillRect(-w / 2, h * 0.1, w, h * 0.4);
  ctx.strokeStyle = colour.ink; ctx.lineWidth = 3; ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

export function plate(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = colour.ink; ctx.lineWidth = 3; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y); ctx.stroke();
  ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); ctx.setLineDash([]);
}

export function liftColumn(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const gradient = ctx.createLinearGradient(0, y, 0, y + h);
  gradient.addColorStop(0, abilityTone.lift.bright); gradient.addColorStop(1, abilityTone.lift.deep);
  ctx.globalAlpha = 0.25; ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  ctx.setLineDash([]); ctx.strokeStyle = abilityTone.lift.deep; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
}

export function portalRing(ctx: Ctx, x: number, y: number, r: number) {
  inkCircle(ctx, x, y, r, '#FFFFFF', abilityTone.portal.deep, 4);
  ctx.beginPath(); ctx.arc(x, y, Math.max(2, r - 7), 0, Math.PI * 2); ctx.strokeStyle = abilityTone.portal.bright; ctx.lineWidth = 2; ctx.stroke();
}

export function beam(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, bright: string) {
  ctx.setLineDash([]); ctx.lineCap = 'round';
  for (const [color, width, alpha] of [[bright, 12, 0.35], [bright, 6, 1], ['#FFFFFF', 2, 1]] as const) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}

export function tag(ctx: Ctx, text: string, x: number, y: number, size = 14) {
  ctx.font = uiFont(size);
  const w = ctx.measureText(text).width + 14, h = size + 10;
  ctx.setLineDash([]); ctx.fillStyle = colour.panel; ctx.strokeStyle = colour.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = colour.ink; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 7, y + h / 2 + 1); ctx.textBaseline = 'alphabetic';
}
