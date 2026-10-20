# Chogmog

Make mischief move.

This private repository contains the T0 physics foundation and a T1/T2 first-chain preview using authentic Genesis metadata and artwork. The playable sequence is ball release, laser sensor, balloon pop, physical confetti lift, portal, lever contact and a chosen message. It supports Run/Pause/Reset, source swaps, geometry edits and local arrangement recovery.

T0 through T6 have local/automated technical acceptance. T3 adds validated, immutable part/scene formats and canonical content IDs. T4 adds local wallet sign-in and read-only current-ownership checks. T5 adds the shared Postgres auth/publication backend described below. T6 adds the bounded holder editor and part sandbox. T8's free preview composer passed recorded local Chrome acceptance. T9 adds exact published-part loading, machine publication review/signing and original-credit readback, pending browser acceptance. Genuine holder publication, positive-owner loading and browser publication, hosted activation and production deployment remain unverified. Public-data previews prove neither ownership nor holder permission.

The owner controls final visual design. Do not change repository visibility without explicit owner approval. No public source licence has been granted.

## Run locally

Use Node 24 and pnpm 12.8.1, declared in `package.json`. No secrets, wallet, database or paid service is required.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite uses port 5173 by default. `pnpm preview` serves a production build on port 4173. Both commands bind to all interfaces for development previews, so run them only on a trusted development machine.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:physics
pnpm test:chain
pnpm test:sources
pnpm test:domain
pnpm test:wallet
pnpm test:backend
pnpm build
# All checks, in order:
pnpm check
```

Clean-checkout acceptance uses `pnpm install --frozen-lockfile` followed by `pnpm check`. GitHub Actions runs those commands on Node 24. There are no additional pre-commit hooks.

## Shared backend and publication API, T5

`PostgresStore` implements shared one-time challenge consumption, digest-only sessions, revocation, content-bound publication grants and immutable version storage. SQL transactions serialize competing idempotency keys, check the active session and grant, write the version and source credits, and consume the grant together. Failure rolls everything back. Database constraints and triggers enforce content hashes, uniqueness and immutable published records. `anon` and `authenticated` have no schema/table access, and RLS has no client policies. Browser access is through the API only, not Supabase Auth or direct database writes.

The migration runs only when explicitly invoked. It never starts from an HTTP request. Use a dedicated hosted Supabase or Neon database and its server-only Postgres/pooler connection with `sslmode=verify-full`. On Neon, run migrations over the direct connection, without the `-pooler` hostname suffix, not another application's credentials. If its certificate chain requires the official Supabase CA, configure `NODE_EXTRA_CA_CERTS` with that public CA. Never use `no-verify` or disable certificate verification. No local Postgres or Docker is required or allowed for this project.

Set these only in the server environment, never with a `VITE_` prefix:

```text
APP_ORIGIN=https://your-exact-chogmog-domain.example
CHOGMOG_DATABASE_URL=<dedicated Supabase or Neon connection, TLS verify-full>
CHOGMOG_BACKEND_ENABLED=false
```

After securely supplying the dedicated connection, run `pnpm db:migrate`. It checks migration checksums and applies each file once in a transaction. The migration role owns the isolated `chogmog` schema. Keep database statement/parameter logging disabled for auth and publication queries. Never log cookies, signed messages, signatures, connection strings or request bodies. Expired sign-in/session rows are pruned on the next issuance. Expired publication grants are pruned on the next prepare. Receipts and published history remain immutable. Pending grants store only scope/message metadata, not unpublished content.

Only enable `CHOGMOG_BACKEND_ENABLED=true` after migration, grant checks and hosted integration acceptance. The backend requires exact HTTPS `APP_ORIGIN`, verified Supabase TLS and the expected migration version. Missing configuration or unavailable storage returns 503, without falling back to memory or exposing internal errors. No Chogmog hosted database has been provisioned or enabled yet. The existing Vite harness retains memory-only development sign-in and returns 503 for publication, leaving free play and local drafts usable.

The frozen v1 routes are:

| Route | Input and result |
| --- | --- |
| `GET /api/auth`, `POST /api/auth?op=challenge\|verify\|logout` | Existing wallet protocol, now backed by shared state when enabled. |
| `GET /api/owner?token=533` | Existing fresh authenticated ownership observation. Never a publication grant. |
| `GET /api/holder-source?token=533` | Authenticated current owner only. Fresh ownership followed by bounded Genesis metadata/artwork resolution and a session recheck. Returns a source snapshot, not publication authority. |
| `POST /api/publish?op=prepare` | `{content, key}`. Validate exact T3 part/machine, authenticated author, trusted source pins and registry. Return `{nonce, message, versionId, expiresAt, summary}` for a separate gas-free EOA signature. |
| `POST /api/publish?op=commit` | `{content, key, nonce, signature}`. Revalidate content, exact issued message scope and session, refresh part ownership, then atomically persist. Return the immutable version, observation, timestamp and credits. |
| `GET /api/versions?id=sha256:...` | Public readback of one exact committed version and original credits. No private grants, sessions or drafts. |
| `GET /api/versions?id=sha256:...&source=1` | Public read of one committed holder part and its trusted, bounded source snapshot. No current-owner check is needed for historical reuse. Unknown/unverified records are rejected. Source loading may fail closed if the snapshot is unavailable. |

Use a random 16-64 character alphanumeric/underscore/hyphen `key` for an operation, retaining it for retries. A key with different content returns 409. The same key and content returns the original version. After an uncertain response, a still-authenticated original author may recover the original receipt even after the grant expires or is cleaned up. Receipt recovery cannot create or alter work and does not require renewed NFT ownership. New publications always require a fresh signed authorization.

The publication message binds operation, kind, work ID, author, chain 143, exact origin, content hash, idempotency key, nonce and five-minute expiry. It is separate from sign-in and bound to that session. No raw signature or session credential is stored. Part prepare and commit independently read `ownerOf` and `tokenURI`. Commit rejects observations older than ten seconds at the database boundary and records their block/hash. Blockchain observations and database commits cannot be atomic, so transfers or reorganizations after the final observation remain a documented race. Source ownership changes do not rewrite historical authors or credits.

The trusted source resolver retains the two hash-verified authentic snapshots and resolves other Genesis tokens from their exact observed metadata URI. It supplies metadata, never ownership. Deployed publication always uses the real chain adapter. Synthetic test ownership/registries are never wired into production. Machine publication requires actual committed reusable parts and a direct Chog action connection, without requiring the machine author to hold an NFT. Structural publication does not establish causal replay. Exact same-key receipt recovery compares normalized immutable content before source/RPC reads, so gateway failures cannot hide an already committed receipt. New publications still require full source validation and any applicable fresh ownership checks.

## T8 free machine composition, local preview browser acceptance passed

Open `?harness=machine` or follow the free-machine link on the first-chain page. No wallet or backend is needed. Five compact, exact-version preview parts use authentic public token 533 or 846 sources. They are visibly unverified public-data demonstrations with a placeholder author, not holder-authored publications. No genuine part catalogue, reuse counts or publication button is supplied by this preview.

Arrange up to six source instances, change only their exposed numeric controls, add ordinary balls/ramps/sensors, wire compatible event/body sockets, schedule event inputs and edit the message. Editing resets the bounded shared Rapier world. Run, Pause and Reset are separate controls. The default chain releases a physical ball through a sensor, fires a real laser ray, pops a balloon into twelve physical confetti bodies and opens the message through typed event connections. Moving the sensor, removing a wire or changing the exposed aim breaks the corresponding interaction.

The runtime expands namespaced source objects and applies instance offsets without mutating their pinned versions. Fire lift and Wizard portals interact with bodies in the same world. Body wires restrict linked sensors/lift/portals to the routed bodies, while geometry still determines contact. Release, push, laser and lever gates fire once per run and rearm on Reset. Runs stop at 720 fixed ticks, pause in hidden tabs and bound physical bodies, velocity, wire signals and causal events. The original first-chain and single-part harnesses remain available.

Valid edits autosave only the strict T3 scene under `chogmog.machine-draft.v1`. Reload resolves the exact known preview versions and revalidates all source pins, traits, placements, controls, sockets and expanded budgets. Unknown versions, unexposed overrides, invalid/corrupt/oversized data or denied reads recover a fresh labelled preview draft. Denied writes retain the current playable draft in the tab and show a warning. No wallet session, ownership observation, signature or publication grant is saved with a machine draft. Full undo/redo remains cut.

This preview route still admits only labelled preview versions and never exposes publication. T9's separate route adds exact committed-part loading. Discovery and genuine-holder/hosted acceptance remain open. Preview composition is not genuine-holder or publication evidence.

## T9 machine publication, browser acceptance pending

Open `?harness=published`, separate from public-preview composition. Paste an exact committed reusable part ID, arrange it, edit its exposed controls, wire compatible sockets and run it without a wallet or NFT. The library starts empty, never substitutes fixtures for missing records, checks the server's committed-version/source response and recomputes the exact part hash. Published mode rejects preview versions at loading, resolution, edit validation and draft recovery, before they can be saved. Only the separate preview route opts into preview resolution. Bounded lookups cache only validated records in memory. Restored drafts reload their pins from the server, not client-defined part objects. Local Vite and the disabled hosted backend do not supply a genuine library.

Optional wallet sign-in is shared with T4 but does not request NFT ownership for machine authors. Review validates the exact machine for publication, binds its author to the signed-in wallet and requests a separate five-minute, origin/content/key-bound gas-free message. Signing is explicit. The client checks wallet, chain, session, expiry and operation identity before committing, then reads the exact saved machine and unique original source credits back from the API. Changed drafts, runs, wallets or unmounted editors invalidate the pending review. No transaction, approval, custody or payment is added.

Valid published-part drafts use `chogmog.published-machine-draft.v1`, separate from preview drafts. Only the content hash and retry key use `chogmog.machine-attempt.v1`. Neither storage key includes signatures, credentials, authorizations or ownership authority. Cancelled/failed signatures preserve drafts. Uncertain commits recover the same server receipt before another signature. Denied writes warn, invalid edits retain the last saved draft, and unavailable source reads fall back without overwriting it. Full source replay after reload needs the trusted snapshot service to be available.

The persisted result links to `?harness=published&version=sha256:...`. It reopens exact source versions and original credits, even after NFT transfer. Editing a reopened publication starts a new machine ID rather than taking over its original author's work. Reused versions retain their original authors and permissions. No activity counts are fabricated.

## T11 discovery and remix lineage

Open `?harness=gallery` for committed machines or `?harness=library` for reusable holder parts. The first-chain page and both composers link to these neutral development views. No wallet is needed to browse, inspect source pins, test an exact part/machine with real physics, or add a reusable part through the published composer. The standalone library passes the exact version to the composer for explicit addition. It never silently replaces or saves a draft. Public-data starter/preview links remain separate, with no fixture fallback in the genuine catalogue.

`GET /api/discover?kind=part|machine` returns at most twelve public summaries and an exact-version `next` cursor. Optional `q` is a literal, case-insensitive search up to eighty characters over work ID, author, token ID and machine message. Optional `after` anchors the next page to the full stored publication timestamp and version ID, including timestamp ties and sub-millisecond precision. Unknown, duplicate and unbounded parameters fail closed. SQL is parameterized. Only committed reusable holder parts and committed machines are listed, with no grants, sessions or wallet signatures. Opening an inspection revalidates content hashes, source metadata, permissions and original credits through T9 before enabling physics/reuse. Published-part inspection needs no fresh current-owner check.

Local Vite and the disabled deployed backend return 503 for discovery, just as for publication/version reads. The UI distinguishes unavailable discovery, loading, successful empty/no-match results and failed exact-version verification. It never represents an outage as an empty catalogue or substitutes previews. Synthetic test records establish no genuine holder activity. Hosted activation is unchanged and still requires a dedicated accepted database.

The additive `002_discovery.sql` migration creates the bounded-page ordering index. Do not edit the original migration or enable the hosted backend automatically. Explicit migration now requires both `001_publication.sql` and `002_discovery.sql` before the deployed adapter will serve requests. No new dependency, local PostgreSQL, Docker or second service is needed.

New remixes store optional `Scene.remixOf`, the exact parent machine version, inside canonical signed immutable content. Older scenes omit the field and retain their original hashes. Opening a publication never saves a draft. Explicit Remix asks before replacing the saved draft, generates a new machine ID, preserves source pins/wires/scheduled inputs, and retains the parent's exact ID. Editing a reopened publication also starts a remix. A fresh unrelated draft drops lineage. Publication rejects malformed/missing/non-machine parents and reuse of the parent's work ID. Readback and retries preserve lineage without recursive parent loads. The parent link records declared provenance, not a claim that two machines are identical or that a wallet currently owns an NFT.

Daily prompts and genuine reuse counts remain T20. Final UI/branding remain owner-controlled. T11 browser acceptance, genuine-holder and dedicated hosted-backend acceptance are separate gates, not established by automated/synthetic tests.

Technical tests use explicitly synthetic chain owners and isolated storage. CI exercises the actual client/API/PostgreSQL path, lost-save recovery and fresh-pool readback. They are not genuine-holder or hosted evidence. T8 and T9 remain in progress for their outstanding acceptance gates. T7 still requires a participating genuine holder and a dedicated migrated/tested hosted backend. Final visual design remains owner-controlled.

## T6 holder part authoring, local browser acceptance

The optional wallet section contains a neutral development part editor. Without a wallet, configure and test a useful baseline release or push part from authentic public token 533 data. Its cyan-laser trait also permits laser. These local source snapshots are visibly unverified and cannot authorize publication. Baseline push/release work for every supported Genesis metadata set, without a rare trait.

After signing in on Monad, manually enter a Genesis token ID and choose **Load my Chog and check ownership**. The server must freshly verify that wallet owns that exact token before resolving metadata. The editor derives the kit from the returned source and offers only implemented, present actions. V1 supports push, release, laser, Fire lift and Wizard portal. Other compiled families are not authorable in this schema. There is no wallet inventory indexer. RPC, metadata or artwork failure keeps the draft and blocks publication, rather than inventing traits or ownership.

`src/domain/partAuthoring.ts` compiles bounded presets into the existing immutable T3 format, with a stable public part ID, one Chog action, a ball or laser target balloon, an optional ramp, typed input/output sockets, optional exposed numeric control and explicit default-off reusable permission. The 8-by-8 preview uses real fixed-step Rapier, with Run/Pause/Reset, causal events, tab-hide pause, a 720-tick cap and bounded bodies/events/velocity. Push strength, laser aim, lift, portals and release height affect physical behaviour. `src/game/partPreview.ts` is a single-action authoring sandbox, not a general connection-graph or multi-part machine interpreter. Its neutral canvas is not the owner's final visual design.

## T19 Shout action

Shout is a one-shot radial impulse on nearby dynamic bodies. Its bounded strength and range come from the action document, and only Chogs whose metadata kit includes Shout can author or publish it. Token 846 is the public-data preview source used by the composer.

## T21 My Chog preview-holder mode

Open `?harness=chog` or choose **My Chog** to check ownership and make a part. Preview Chogs 846 and 533 use pinned public metadata, not holder evidence. The PREVIEW label stays with the editor, and preview parts remain in this browser. They cannot be published, counted as reuse or shown as holder work. Use **Use in my Build draft** to add one to the local machine draft.

Review the exact content, source pins, author, controls and reuse permission before **Review exact part for publication / recover save**. On an enabled shared backend, prepare returns a separately scoped EIP-4361 message. The client validates its address, domain, origin, chain, statement, nonce, content hash, retry key and expiry before offering **Sign and publish this exact part**. That button is the only publication signature request. Account, chain, source or draft changes invalidate the pending approval. Commit still revalidates exact content, session and fresh ownership server-side. A success result requires exact-version public readback. Existing published authors, credits and reuse permissions remain immutable after an NFT sale.

Validated settings and public source pins/metadata persist locally, without any holder permission. A separate retained retry record contains only version ID and idempotency key. No signature, nonce, approval message, cookie or session credential is written to browser storage. Rejected signatures, failed ownership/source reads, storage denial and uncertain saves keep the draft. Retry review with the same content/key first recovers any completed receipt without another signature. After reload, the signed-in original author can recover an exact matching saved attempt even after a transfer. A new publication still requires current ownership. Storage denial shows a warning and retains in-tab operation identity, but reload recovery cannot be promised. These are local browser drafts, not private durable drafts or a catalogue.

`src/server/holderSource.ts` accepts only the fixed Genesis metadata/artwork CIDs at `ipfs.io` and `dweb.link`, with fixed HTTPS paths, no caller URLs, redirects or credentials, and four-second per-request deadlines. Metadata is capped at 16 KiB and parsed through the strict trait parser. Artwork is capped at 1 MiB, validated as WebP and limited to 1024 pixels per dimension. The server computes both SHA-256 pins, and publication re-resolves and compares exact bytes against them. A gateway failure is unavailable, not a substitute source. These are trusted fixed gateways, not a new browser open proxy or a cryptographic IPFS DAG verifier. The existing two-entry artwork route remains unchanged. The neutral authoring canvas uses labelled geometry for non-preview tokens, not an unrestricted remote artwork renderer.

`pnpm test:authoring` covers the compiler, real physics, local recovery, bounded loading, unauthorized source rejection, exact review/sign/commit/readback, changed wallets/chain/drafts and uncertain-response retry using synthetic ownership and storage. `pnpm test:backend` additionally includes a CI-only T6 client/API/Postgres baseline test for a synthetic non-fixture token. No local Postgres or Docker is required. Recorded local Chrome acceptance passed at b34e283 for the editor, physics, drafts, synthetic sign-in and live non-owner rejection. Positive-owner loading and browser publication review/sign/commit/readback remain untested. Hosted activation remains disabled until a dedicated Chogmog database is migrated and tested. Vite publication deliberately returns 503. T7 genuine-holder evidence, T8 browser/published-part acceptance, T9 machine publication UI and deployed persistence remain open.

`pnpm test:backend` runs fast API negatives locally, with the Postgres suite explicitly skipped without its isolated database. GitHub Actions supplies PostgreSQL 17 and `CHOGMOG_TEST_DATABASE_URL`, requires that variable, migrates twice and runs the same full check with real transactions, concurrency, rollback, cross-instance reads and database role/immutability tests. CI uses synthetic wallets and ownership, never genuine-holder evidence or a production service. `pg@8.16.3` and its types are exact-pinned. `pnpm-workspace.yaml` overrides `ws` to patched `8.21.0` for the existing wallet dependencies.

## First-chain preview

- The default page is the neutral trait-powered preview. `?harness=falling` opens the original T0 regression harness.
- Genesis token 846 maps to artwork 338, with exact `Aura = Fire` and `Head = Wizard Hat`. Token 533 maps to artwork 25, with exact `Eyes = cyan laser` and no Fire or Wizard traits. Names such as `CHOG #338` are artwork names, not on-chain token IDs.
- The compiler exposes all documented family kits. This slice executes baseline release, laser, bounded lift and portal movement only. The remaining abilities are compiled but not yet playable.
- A physical ball intersects a sensor, an actual Rapier ray hits the balloon, twelve rigid-body confetti pieces receive bounded impulses in the lift region, and a permitted portal rotates their velocity by a quarter turn. At least one confetti body must contact the lever to open the banner. No timer secretly advances the chain.
- Change lift or portal source to token 533, or laser source to token 846, to remove the corresponding capability. Move the ball, change the aim or change portal exit height to alter the outcome. These inputs are bounded, allowlisted data, never scripts or client-supplied abilities.
- Reset reconstructs the world, bodies, cooldowns, events and one-shot outputs. Runs use 60 fixed ticks per second, stop at 720 ticks, cap catch-up at six steps and pause on hidden tabs. The initialization uses stable IDs, seed 143 and trait rules version 1. Repeatability is tested with the pinned engine, not promised across upgrades or browsers.
- Local arrangement data uses `chogmog:first-chain:v1`, at most 2048 serialized characters. Invalid or unavailable storage falls back to defaults. Messages are plain text, 1 to 80 characters. This is not durable publication.
- The canvas has a DOM telemetry summary and inspectable tick-level causal events. Failed chains show the missing interaction. Missing artwork leaves labelled geometry playable.

## Authentic assets and provenance

`fixtures/genesis` preserves the original JSON and WebP bytes, plus a provenance manifest containing original IPFS URIs, chain, collection, observed block, retrieval time and SHA-256 hashes. Read-only `eth_chainId` returned `0x8f` and `eth_call` for `tokenURI(846)` and `tokenURI(533)` at block `0x6d1a34c` confirmed the distinct artwork mappings. These original fixtures did not check ownership or signatures.

Primary retrieval was `https://ipfs.filebase.io/ipfs/<CID>/<artwork>.<extension>`. The two CIDs are recorded in the manifest. Requests were bounded with `curl --fail --show-error --silent --max-time 60`. Gateway delays were observed, so runtime delivery uses the prewarmed, hash-pinned local cache rather than relying on a live gateway or arbitrary URL fallback.

`GET /api/source?kind=artwork&id=338` and the equivalent metadata request serve only the two allowlisted entries. Vite dev/preview and the Node function share the handler. No user URL, arbitrary CID, redirect or upstream fetch is accepted. Cache files are hash-checked, responses are same-origin and `nosniff`, metadata is limited to 16 KiB, and images to 1 MiB and 1024 pixels per dimension. The browser verifies the digest and supported WebP header before decode and uses a four-second fetch deadline. The current previews are 1000×1000 WebP, 264448 and 301120 bytes.

The renderer loads those same-origin bytes into Pixi textures, releases bitmaps/textures on disposal and retains geometry when image loading fails. Recorded Chrome acceptance verified both textures, WebGL 2 upload, origin-clean canvas export/readback and blocked-artwork fallback. Local fresh-page readiness was about 1.025 seconds, with both artworks ready at 1.083 seconds. These are not cold-machine or production timings. Other browsers, physical devices and browser timeout/digest-rejection paths remain unverified. In-app export is out of scope.

`api/source.ts` is a Vercel Node Web-standard handler. `vercel.json` includes the pinned cache in a future function bundle. A plain static upload of `dist/` alone will not serve the asset route. This deployment adapter has not been deployed or verified on Vercel.

## Domain format v1

`src/domain/documents.ts` defines runtime-validated `SourcePin`, `PartContent`, `PartVersion` and `Scene` formats. External payloads use exact fields, finite numbers and fixed schema/rules/engine versions. Token IDs are canonical uint256 decimal strings, separate from artwork numbers. Source pins retain original IPFS URIs, both SHA-256 hashes and observation time.

`createPartVersion(content, resolveSource)` resolves the pinned snapshot through a **trusted** source adapter, derives the real trait kit and rejects unsupported actions. The existing `resolvePreviewSource` adapter cross-checks the two hash-verified public fixtures. A resolver must never trust client-provided metadata or a kit. Content contains exactly one Chog source, typed props, allowlisted actions, typed sockets, exposed numeric controls and internal connections. Nested parts, scripts and hidden overrides are rejected. V1 actions are push/release/laser/lift/portal; other compiled families need a later schema/adapter revision before authoring.

Versions are `sha256:<64 lowercase hex>` over normalized canonical content and are deeply frozen, with no aliases to the input. Editing creates a different version ID. Part author, source and reuse permission remain in that exact version, even if ownership or newer versions later change. Publication timestamps, fresh ownership observations and signature/idempotency records belong to the later T4/T5 server envelope, not to an asserted authorization result here.

`validateMachine(scene, resolvePart, resolveSource, purpose)` loads each exact version, recomputes its content ID and checks reuse permission. Instances have a placement and a values map keyed only by author-exposed control IDs. Source contents and ability lists cannot be overridden. Named socket direction/type, tick inputs, all local geometry and placement are checked. Expanded limits include every instance: six parts, thirty props, eighty potential dynamic bodies, twelve confetti per balloon and two hundred total connections. Inputs are capped at two hundred ticks/events within ticks 0 to 719. The simulation still enforces its separate two-hundred-event runtime cap.

The default purpose is `draft`. `publication` additionally rejects public-data-preview registry entries and requires a connection directly touching an exposed Chog action socket. Registry origin is **trusted server state**, never an editable scene field. Passing this structural gate does not prove wallet authentication, current ownership, actual publication or causal replay. T5 supplies a registry of committed versions, with genuine-holder acceptance still open.

`src/domain/canonical.ts` defines application canonical JSON v1: object keys sorted by UTF-16 code units, finite JSON numbers with negative zero normalized, UTF-8 hashing and ordered arrays. Domain parsing sorts object collections by stable IDs, connections by their canonical endpoints and inputs by tick then ID. It rejects undefined, accessors, custom objects, cycles, sparse arrays and oversized input. Limits are 64 KiB UTF-8, depth 16 and 4,096 nodes, with at most 1,023 array elements. This is an application contract, not a claim of implementing an external canonicalization standard.

These formats supply the T6 single-part editor, T8 preview machine composer and T5 durable publication endpoints. The accepted first-chain UI still uses its existing bounded arrangement format. `tests/documents.test.ts` exercises the contract using clearly synthetic registry state, never genuine holder evidence. T8 uses a shared bounded world for allowlisted graphs, with preview-only catalogue UI and browser acceptance still open.

## T4 local wallet and ownership check

The neutral first-chain page now has an optional wallet section. With a browser-injected wallet on Monad chain 143, use Sign in with wallet to sign an EIP-4361 message. The server creates the message with the local origin, exact wallet address, chain ID, one-time random nonce, five-minute expiry and a clear gas-free purpose. The EOA signature is checked on the server against the exact issued message. Consuming the challenge prevents replay even after a failed verification. The server creates a random opaque 30-minute session in an HttpOnly, SameSite=Strict cookie with `Secure` on HTTPS. POST actions require a matching Origin. Sign out revokes the session, and a wallet or chain change clears the page's signed-in state. No signature is logged or stored and no private key is requested.

Enter a Genesis token ID to ask the server to read `ownerOf` and `tokenURI` from the fixed Genesis collection at the same freshly observed Monad block. The server verifies chain 143, the expected metadata CID, block timestamp and unchanged block hash, then compares the observed owner with the signed-in address. The response includes the owner and observation block. Non-owner returns `isOwner: false`; stale, unknown, reorganized or failed RPC reads return 503 without claiming non-ownership. T3 `SourcePin` chain, collection, token ID and URI can be checked against this observation. Client wallet lists and preview labels never authorize it. A new read occurs for every ownership request, so transfer after login changes the answer. This is a read-only status check, not an endpoint that grants publishing permission. The time between a read and a future storage commit cannot be atomic; T5 must recheck close to the commit.

Vite dev/preview serves these endpoints only on `localhost` or `127.0.0.1`. Its bounded in-memory nonce and session store is for local development and automated acceptance, and it resets when the server restarts. T5 supplies a shared backend for Vercel adapters, which still return 503 until explicitly configured and enabled. Do not advertise production sign-in without hosted acceptance. No production domain, wallet credential or database secret is needed for local work. Public play and local arrangements keep working during RPC outages.

Recorded local incognito Chrome acceptance passed at `cb1c1b6` with fresh unfunded synthetic accounts held only in memory. The actual UI completed server-issued sign-in, session reload, live non-holder reads for token 846, logout and account/chain-change invalidation. Wrong-chain, denied-signing, malformed-ID and no-wallet paths passed, alongside a free-play Run/Pause/Reset regression. The first attempted recording found an empty HTTP-body-stream logout bug, fixed at this revision with real Vite HTTP regression coverage. No keys, raw signatures or credentials were recorded. Genuine-holder sign-in, positive-owner/transfer browser simulation, wallet-extension UX, contract-account support and production authentication remain unverified. This acceptance does not establish publication or deployment.

## Original T0 harness contract

- Real 2D rigid-body physics at 60 fixed steps per second. One ball and one fixed floor, with stable logical IDs and a 720-tick/12-second simulation budget.
- A frame performs at most six physics steps. Excess wall time after a stall is discarded. The harness pauses when the browser tab is hidden.
- Reset rebuilds the world and clears tick, velocity and accumulated time while preserving the selected arrangement. Changing any control resets the world too.
- Arrangement-only settings are validated and stored under `chogmog:falling-scene:v1`. Corrupt, oversized or unavailable storage falls back safely. This is local debug storage, not durable product drafts or publication.
- WASM and the Pixi renderer initialize asynchronously. Controls stay disabled until ready. Unmount/cancel frees the world, renderer, ticker and visibility listener.
- The scene is intentionally plain. Nothing in it demonstrates Genesis ownership, trait essentiality, genuine holder publication or a mainnet transfer.

## Structure

- `src/domain`: source parsing, trait compilation, bounded arrangements, artwork validation, local recovery and the T3 part/scene/canonicalization contracts.
- `src/game`: isolated physics, causal chain, fixed-step clock and Pixi renderer adapters. Tests use the actual WASM engine, not mocked movement.
- `src/server` and `api`: restricted cache, local memory auth and the opt-in shared Postgres auth/publication backend. Server secrets never enter browser code.
- `src/chain`: separate exact-collection read-only owner and token URI checks. No NFT custody or transfer calls.
- `fixtures/genesis`: authentic public-data previews and provenance, never genuine holder publications.
- `src/ui`: development controls and labelled debug canvas.
- `tests`: source integrity, image bounds, actual HTTP routing, causal chain/trait swaps, repeatability, physics, limits and storage checks. The image decode unit tests use a bitmap stub and do not establish WebGL acceptance.

The server-only publication paths and shared auth persistence are implemented but remain undeployed. The six-day plan uses Vercel server functions, not a second service or multi-package workspace. Do not expose privileged keys in Vite code or unrestricted asset fetchers.

## Engine choice

Direct dependencies are exact-pinned and the pnpm lockfile pins transitive resolution. React 19.3.0, Vite 8.3.4, PixiJS 8.22.0 and Rapier 2D compat 0.21.0 were selected from established releases. TypeScript 6.0.2 stays inside typescript-eslint 8.71.1's supported compiler range. Vite and PixiJS use MIT licences, React uses MIT, TypeScript and Rapier use Apache-2.0.

The normal Rapier package was probed first. Vite's browser library build passed, but Vitest's Node resolver could not resolve its package entry. The compat package gives the browser and Node tests the same asynchronously initialized engine without a custom loader. It embeds WASM and is lazy-loaded separately from the shell, with a significant first-canvas download. Revisit the normal package if this affects the demo's loading budget. Do not claim a smaller bundle until it is measured.

## Canonical plan

[Notion project hub](https://app.notion.com/p/3f3c5381831281e9b8d8e4f7fdb8e322)

[Build](https://app.notion.com/p/3f3c5381831281718d4ada67960ba5a4) · [Tasks](https://app.notion.com/p/3f3c5381831281f8b8bbc290b0de3e03) · [Handoff](https://app.notion.com/p/3f3c538183128181bc4fc6c482e4b04c)

T1/T2 and the technical first-playable gate passed recorded Chrome acceptance. T3 provides the reusable domain/part contract. T4 adds local EOA sign-in and fresh read-only ownership checks, and T5 adds durable auth storage and content-bound publication infrastructure. T6 connects the holder editor, local part sandbox and explicit publication review, with local editor browser acceptance. T8 adds free shared-world preview composition, pending browser and actual published-part acceptance. First-time comprehension and voluntary repeat interest remain unvalidated. Final visual design and genuine holder participation remain external gates.
