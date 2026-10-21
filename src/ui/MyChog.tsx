import { placePreviewPartInDraft } from '../domain/machineDraft';
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
  return placePreviewPartInDraft(storage, createLibrary, version);
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
