import fireWizard from '../../fixtures/genesis/338.json' with { type: 'json' };
import laser from '../../fixtures/genesis/25.json' with { type: 'json' };
import provenance from '../../fixtures/genesis/provenance.json' with { type: 'json' };

export type Ability = 'push' | 'release' | 'lift' | 'portal' | 'laser' | 'bounce' | 'slick' | 'spray' | 'coin' | 'shout';
export const TRAIT_RULES_VERSION = 1;
export interface Trait { trait_type: string; value: string }
export interface Metadata { name: string; image: string; attributes: Trait[] }

export function parseMetadata(value: unknown, artworkNumber: number): Metadata {
  if (!value || typeof value !== 'object') throw new Error('Invalid metadata');
  const m = value as Record<string, unknown>;
  if (typeof m.name !== 'string' || m.name.length > 120 ||
      m.image !== `ipfs://${provenance.artworkCid}/${artworkNumber}.webp` ||
      !Array.isArray(m.attributes) || m.attributes.length > 32) throw new Error('Invalid metadata');
  const seen = new Set<string>();
  const attributes = m.attributes.map((trait: unknown) => {
    if (!trait || typeof trait !== 'object') throw new Error('Invalid trait');
    const t = trait as Record<string, unknown>;
    if (typeof t.trait_type !== 'string' || !t.trait_type || t.trait_type.length > 80 ||
        typeof t.value !== 'string' || !t.value || t.value.length > 120 || seen.has(t.trait_type)) {
      throw new Error('Invalid or duplicate trait');
    }
    seen.add(t.trait_type);
    return { trait_type: t.trait_type, value: t.value };
  });
  return { name: m.name, image: m.image, attributes };
}

export function compileKit(metadata: Metadata): Ability[] {
  const kit: Ability[] = ['push', 'release'];
  for (const { trait_type: type, value } of metadata.attributes) {
    if (type === 'Aura' && ['Fire', 'Fiery Aura', 'Burning Aura'].includes(value)) kit.push('lift');
    if (type === 'Head' && ['Wizard Hat', 'Wizard Beanie'].includes(value)) kit.push('portal');
    if (type === 'Eyes' && ['fire laser', 'Purple laser', 'Green laser', 'cyan laser'].includes(value)) kit.push('laser');
    if (type === 'Mouth') {
      if (value === 'Bubblegum') kit.push('bounce');
      else if (value === 'Drooling') kit.push('slick');
      else if (value === 'Rainbow Puke') kit.push('spray');
      else if (['Mon coin', 'BTC Coin'].includes(value)) kit.push('coin');
      else kit.push('shout');
    }
  }
  return [...new Set(kit)];
}

export const PREVIEWS = provenance.entries.map((source) => {
  const raw = source.tokenId === '846' ? fireWizard : laser;
  const metadata = parseMetadata(raw, source.artworkNumber);
  return Object.freeze({ ...source, metadata, kit: compileKit(metadata), mode: 'public-data-preview' as const });
});
export type Preview = typeof PREVIEWS[number];
export function getPreview(tokenId: unknown): Preview {
  const source = PREVIEWS.find((p) => p.tokenId === tokenId);
  if (!source) throw new Error('Unsupported preview source');
  return source;
}
export { provenance };
