import { jsonResponse } from '../src/server/walletAuth';

export default { fetch: async () => jsonResponse({ error: 'Authentication requires a shared nonce and session store before deployment' }, 503) };
