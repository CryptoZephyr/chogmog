import { useEffect, useRef, useState } from 'react';

interface InjectedWallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
}
const injected = () => (window as Window & { ethereum?: InjectedWallet }).ethereum;

async function api(path: string, method = 'GET', value?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(path, { method, credentials: 'same-origin',
    ...(value === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) });
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object') throw new Error('Invalid server response');
  const data = result as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  return data;
}

export function WalletPanel() {
  const [address, setAddress] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState('846');
  const [observation, setObservation] = useState<string | null>(null);
  const [status, setStatus] = useState('Checking local sign-in…');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    let live = true;
    const initialSequence = sequence.current;
    const wallet = injected();
    const walletChanged = () => {
      sequence.current++;
      if (live) { setAddress(null); setObservation(null); setStatus('Wallet or chain changed. Sign in again.'); }
      void api('/api/auth?op=logout', 'POST').catch(() => undefined);
    };
    wallet?.on?.('accountsChanged', walletChanged);
    wallet?.on?.('chainChanged', walletChanged);
    void api('/api/auth').then(async (session) => {
      if (!live || sequence.current !== initialSequence) return;
      if (!session.address || typeof session.address !== 'string') {
        setStatus('No wallet session. The chain stays free to play.');
        return;
      }
      const accounts = wallet ? await wallet.request({ method: 'eth_accounts' }) : [];
      const chain = wallet ? await wallet.request({ method: 'eth_chainId' }) : '';
      if (!live || sequence.current !== initialSequence) return;
      if (Array.isArray(accounts) && accounts.some((item) => typeof item === 'string' && item.toLowerCase() === (session.address as string).toLowerCase()) && chain === '0x8f') {
        setAddress(session.address); setStatus('Signed in on Monad. NFT ownership is checked only when requested.');
      } else walletChanged();
    }).catch(() => { if (live && sequence.current === initialSequence) setStatus('Wallet sign-in is unavailable. Free play still works.'); });
    return () => { live = false; wallet?.removeListener?.('accountsChanged', walletChanged); wallet?.removeListener?.('chainChanged', walletChanged); };
  }, []);

  const signIn = async () => {
    const wallet = injected();
    if (!wallet) { setStatus('No injected wallet found. Install or open a compatible wallet to sign in.'); return; }
    sequence.current++;
    setBusy(true); setAddress(null); setObservation(null);
    try {
      await api('/api/auth?op=logout', 'POST');
      const accounts = await wallet.request({ method: 'eth_requestAccounts' });
      const chain = await wallet.request({ method: 'eth_chainId' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('No wallet account selected');
      if (chain !== '0x8f') throw new Error('Select Monad mainnet, chain 143, in your wallet.');
      const cycle = sequence.current;
      const challenge = await api('/api/auth?op=challenge', 'POST', { address: accounts[0] });
      if (typeof challenge.message !== 'string' || typeof challenge.nonce !== 'string') throw new Error('Invalid sign-in challenge');
      const signature = await wallet.request({ method: 'personal_sign', params: [challenge.message, accounts[0]] });
      const current = await wallet.request({ method: 'eth_accounts' });
      if (cycle !== sequence.current || !Array.isArray(current) || !current.some((a) => typeof a === 'string' && a.toLowerCase() === accounts[0].toLowerCase()) ||
          await wallet.request({ method: 'eth_chainId' }) !== '0x8f') throw new Error('Wallet changed during sign-in');
      const session = await api('/api/auth?op=verify', 'POST', { nonce: challenge.nonce, message: challenge.message, signature });
      if (typeof session.address !== 'string') throw new Error('Invalid session');
      if (cycle !== sequence.current) { await api('/api/auth?op=logout', 'POST'); return; }
      setAddress(session.address); setStatus('Signed in on Monad. This does not establish NFT ownership.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Sign-in cancelled or unavailable.'); }
    finally { setBusy(false); }
  };

  const checkOwnership = async () => {
    if (!address) return;
    const cycle = sequence.current;
    setBusy(true); setObservation(null);
    try {
      const result = await api(`/api/owner?token=${encodeURIComponent(selectedToken)}`);
      if (cycle !== sequence.current) return;
      if (result.tokenId !== selectedToken || typeof result.isOwner !== 'boolean' || typeof result.blockNumber !== 'string') throw new Error('Invalid ownership observation');
      setObservation(`Token ${result.tokenId}: ${result.isOwner ? 'this signed-in address owns it' : 'this signed-in address does not own it'} at Monad block ${result.blockNumber}. This is a read-only observation, not publishing permission.`);
    } catch (error) { if (cycle === sequence.current) setObservation(error instanceof Error ? error.message : 'Ownership check unavailable.'); }
    finally { setBusy(false); }
  };

  return <section aria-label="Wallet and Genesis owner check">
    <h2>Wallet sign-in, development check</h2>
    <p>Optional. Free play needs no wallet. Signing a login message is gas-free and grants no token approvals. Preview art is never proof of ownership.</p>
    <p role="status">{status}{address ? ` Address: ${address}` : ''}</p>
    <div className="controls">
      <button disabled={busy} onClick={() => void signIn()}>Sign in with wallet</button>
      <button disabled={busy || !address} onClick={() => { sequence.current++; void api('/api/auth?op=logout', 'POST').then(() => {
        setAddress(null); setObservation(null); setStatus('Signed out.');
      }).catch(() => setStatus('Sign-out failed. Retry before leaving this device.')); }}>Sign out</button>
    </div>
    <label>Genesis token ID
      <input type="text" inputMode="numeric" maxLength={78} disabled={busy} value={selectedToken} onChange={(event) => { setSelectedToken(event.target.value); setObservation(null); }} />
    </label>
    <button disabled={busy || !address || !/^(0|[1-9][0-9]*)$/.test(selectedToken)} onClick={() => void checkOwnership()}>Check current ownership</button>
    {observation && <p role="status">{observation}</p>}
  </section>;
}
