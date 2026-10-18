import { jsonResponse } from '../src/server/walletAuth';

export default { fetch: async () => jsonResponse({ error: 'Ownership access requires a deployed authentication store' }, 503) };
