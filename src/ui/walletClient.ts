export interface InjectedWallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
}
export const injected = () => (window as Window & { ethereum?: InjectedWallet }).ethereum;
export type Api = (path: string, method?: string, value?: unknown) => Promise<Record<string, unknown>>;
export const api: Api = async (path, method = 'GET', value) => {
  const response = await fetch(path, { method, credentials: 'same-origin', signal: AbortSignal.timeout(30_000),
    ...(value === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) });
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid server response');
  const data = result as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  return data;
};

export async function assertWallet(wallet: InjectedWallet, address: string) {
  const accounts = await wallet.request({ method: 'eth_accounts' });
  const chain = await wallet.request({ method: 'eth_chainId' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== address.toLowerCase() || chain !== '0x8f') {
    throw new Error('Select the signed-in wallet on Monad, then sign in again.');
  }
}
