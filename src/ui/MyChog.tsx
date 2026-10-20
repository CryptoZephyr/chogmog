import { addPreviewPartToDraft, loadMachineDraft, loadPreviewParts, savePreviewPart } from '../domain/machineDraft';
import { MachineLibrary } from '../domain/machineLibrary';
import type { PartVersion } from '../domain/documents';
import { api } from './walletClient';
import { AppFrame } from './AppFrame';
import { WalletPanel } from './WalletPanel';

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

async function usePreviewPart(version: PartVersion) {
  const createLibrary = () => MachineLibrary.create(
    (id, source) => api(`/api/versions?id=${encodeURIComponent(id)}${source ? '&source=1' : ''}`),
    'preview',
  );
  const library = await createLibrary();
  for (const part of await loadPreviewParts(storage)) await library.addLocalPreviewPart(part);
  const current = await loadMachineDraft(storage, library);
  if (!current.recovered) return { ok: false, message: 'The saved Build draft could not be verified, so it was left unchanged.' };
  if (current.machine.scene.parts.length >= 6) return { ok: false, message: 'Your Build draft already has six parts. Remove one in Build before adding this preview part.' };
  if (!await savePreviewPart(storage, version)) return { ok: false, message: 'This browser could not safely replace a saved preview part.' };
  const updated = await createLibrary();
  for (const part of await loadPreviewParts(storage)) await updated.addLocalPreviewPart(part);
  return addPreviewPartToDraft(storage, updated, version);
}

export function MyChog() {
  return <AppFrame tab="chog" layout="single">
    <main className="single-panel">
      <h1 className="screen-title">My Chog</h1>
      <p>Sign in and check current ownership to author a holder part. Public-data previews stay local and cannot be published.</p>
      <WalletPanel onUsePreviewPart={usePreviewPart} />
    </main>
  </AppFrame>;
}
