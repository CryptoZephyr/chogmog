import { canonicalJson, freezeDocument } from './canonical';
import { parseMetadata } from './chog';
import { createPartVersion, parseScene, parseSourcePin, resolvePreviewSource, validateMachine,
  type PartResolver, type PartVersion, type Scene, type SourceResolver } from './documents';
import { PreviewCatalog, newMachineDraft, type PreviewAction } from './machineDraft';

export const PUBLISHED_DRAFT_KEY = 'chogmog.published-machine-draft.v1';
export type VersionLookup = (id: string, source?: boolean) => Promise<Record<string, unknown>>;
export type MachineCredit = { versionId: string; author: string };
const versionId = (id: string) => /^sha256:[a-f0-9]{64}$/.test(id);

export function machineCredits(machine: Awaited<ReturnType<typeof validateMachine>>): MachineCredit[] {
  return [...new Map(machine.expanded.map(({ version }) => [version.id, { versionId: version.id, author: version.content.author }])).values()]
    .sort((a, b) => a.versionId.localeCompare(b.versionId));
}

export class MachineLibrary {
  private parts = new Map<string, PartVersion>();
  private sources = new Map<string, Awaited<ReturnType<SourceResolver>>>();
  private pending = new Map<string, Promise<PartVersion>>();
  private constructor(readonly previews: PreviewCatalog, private lookup: VersionLookup, private mode: 'published' | 'preview') {}
  static async create(lookup: VersionLookup, mode: 'published' | 'preview' = 'published') {
    return new MachineLibrary(await PreviewCatalog.create(), lookup, mode);
  }
  get(kind: PreviewAction) { return this.previews.get(kind); }
  isPublished(id: string) { return this.parts.has(id); }
  addLocalPreviewPart(value: unknown) { return this.previews.addLocalPreviewPart(value); }
  get previewParts() { return this.previews.previewParts; }
  get published(): readonly PartVersion[] { return [...this.parts.values()]; }
  readonly resolveSource: SourceResolver = async (pin) => this.sources.get(canonicalJson(pin)) ?? resolvePreviewSource(pin);
  readonly resolvePart: PartResolver = async (id) => {
    const version = this.parts.get(id);
    if (version) return { version, origin: 'holder-published' };
    if (this.mode === 'preview') return this.previews.resolvePart(id);
    throw new Error('Holder-published part required.');
  };
  private isPreview(id: string) { return this.previews.isPreview(id); }
  loadPart(id: string): Promise<PartVersion> {
    if (!versionId(id)) return Promise.reject(new Error('Enter an exact sha256 version ID.'));
    if (this.isPreview(id)) return Promise.reject(new Error('Preview parts are not holder-published versions.'));
    const saved = this.parts.get(id);
    if (saved) return Promise.resolve(saved);
    const pending = this.pending.get(id);
    if (pending) return pending;
    if (this.parts.size + this.pending.size >= 32) return Promise.reject(new Error('Library limit reached. Reload to clear unused lookups.'));
    const work = this.readPart(id).finally(() => { this.pending.delete(id); });
    this.pending.set(id, work);
    return work;
  }
  private async readPart(id: string) {
    const result = await this.lookup(id, true);
    const receipt = result.version as { id?: string; content?: unknown; publishedAt?: string; ownership?: { isOwner?: boolean } } | undefined;
    if (!receipt || receipt.id !== id || receipt.ownership?.isOwner !== true ||
        typeof receipt.publishedAt !== 'string' || !Number.isFinite(Date.parse(receipt.publishedAt))) throw new Error('Holder-published part required.');
    const snapshot = result.source as { pin?: unknown; metadata?: unknown } | undefined;
    if (!snapshot) throw new Error('Published source snapshot unavailable.');
    const pin = parseSourcePin(snapshot.pin), metadata = parseMetadata(snapshot.metadata, pin.artworkNumber);
    const source = freezeDocument({ pin, metadata });
    const version = await createPartVersion(receipt.content, async (expected) => {
      if (canonicalJson(expected) !== canonicalJson(pin)) throw new Error('Published source pin mismatch.');
      return source;
    });
    if (version.id !== id || !version.content.reuseAllowed) throw new Error('Exact reusable part version required.');
    this.sources.set(canonicalJson(pin), source);
    this.parts.set(id, version);
    return version;
  }
  async validate(scene: Scene, purpose: 'draft' | 'publication' = 'draft') {
    const parsed = parseScene(scene);
    for (const id of new Set(parsed.parts.map((part) => part.versionId))) {
      if (this.mode === 'published' || !this.isPreview(id)) await this.loadPart(id);
    }
    return validateMachine(parsed, this.resolvePart, this.resolveSource, purpose);
  }
  newPublishedDraft(): Scene {
    const draft = structuredClone(newMachineDraft(this.previews));
    return parseScene({ ...draft, parts: [], connections: [], inputs: [] });
  }
  remix(machine: Awaited<ReturnType<typeof validateMachine>>): Scene {
    const fresh = this.newPublishedDraft();
    return parseScene({ ...machine.scene, machineId: fresh.machineId, author: fresh.author, remixOf: machine.id });
  }
  async reopen(id: string) {
    if (!versionId(id)) throw new Error('Enter an exact sha256 version ID.');
    const result = await this.lookup(id);
    if (result.id !== id || typeof result.publishedAt !== 'string' || !Number.isFinite(Date.parse(result.publishedAt))) throw new Error('Published machine required.');
    const machine = await this.validate(parseScene(result.content), 'publication');
    if (machine.id !== id || canonicalJson(result.credits) !== canonicalJson(machineCredits(machine))) throw new Error('Published machine or original credits differ.');
    return { machine, publishedAt: result.publishedAt, credits: machineCredits(machine) };
  }
}
