# Chogmog

Make mischief move.

This private repository contains the T0 physics foundation and a T1/T2 first-chain preview using authentic Genesis metadata and artwork. The playable sequence is ball release, laser sensor, balloon pop, physical confetti lift, portal, lever contact and a chosen message. It supports Run/Pause/Reset, source swaps, geometry edits and local arrangement recovery.

T0 and T1/T2 passed recorded local Chrome acceptance, with the new chain checked at b670a57. T3 adds validated, immutable part/scene formats and canonical content IDs. T4 adds a local wallet sign-in and read-only current-ownership check. Production authentication requires the shared session/nonce store in T5. Genuine holder publication, durable public machines, payments and production deployment are not connected. Public-data previews prove neither ownership nor holder permission.

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
pnpm build
# All checks, in order:
pnpm check
```

Clean-checkout acceptance uses `pnpm install --frozen-lockfile` followed by `pnpm check`. GitHub Actions runs those commands on Node 24. There are no additional pre-commit hooks.

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

The default purpose is `draft`. `publication` additionally rejects public-data-preview registry entries and requires a connection directly touching an exposed Chog action socket. Registry origin is **trusted server state**, never an editable scene field. Passing this structural gate does not prove wallet authentication, current ownership, actual publication or causal replay. No genuine holder registry is implemented yet.

`src/domain/canonical.ts` defines application canonical JSON v1: object keys sorted by UTF-16 code units, finite JSON numbers with negative zero normalized, UTF-8 hashing and ordered arrays. Domain parsing sorts object collections by stable IDs, connections by their canonical endpoints and inputs by tick then ID. It rejects undefined, accessors, custom objects, cycles, sparse arrays and oversized input. Limits are 64 KiB UTF-8, depth 16 and 4,096 nodes, with at most 1,023 array elements. This is an application contract, not a claim of implementing an external canonicalization standard.

These formats are headless contracts for later authoring/composition. The accepted first-chain UI still uses its existing bounded arrangement format. General part playback, durable version storage and publication endpoints are later work. `tests/documents.test.ts` exercises the contract using clearly synthetic registry state, never genuine holder evidence.

## T4 local wallet and ownership check

The neutral first-chain page now has an optional wallet section. With a browser-injected wallet on Monad chain 143, use Sign in with wallet to sign an EIP-4361 message. The server creates the message with the local origin, exact wallet address, chain ID, one-time random nonce, five-minute expiry and a clear gas-free purpose. The EOA signature is checked on the server against the exact issued message. Consuming the challenge prevents replay even after a failed verification. The server creates a random opaque 30-minute session in an HttpOnly, SameSite=Strict cookie with `Secure` on HTTPS. POST actions require a matching Origin. Sign out revokes the session, and a wallet or chain change clears the page's signed-in state. No signature is logged or stored and no private key is requested.

Enter a Genesis token ID to ask the server to read `ownerOf` and `tokenURI` from the fixed Genesis collection at the same freshly observed Monad block. The server verifies chain 143, the expected metadata CID, block timestamp and unchanged block hash, then compares the observed owner with the signed-in address. The response includes the owner and observation block. Non-owner returns `isOwner: false`; stale, unknown, reorganized or failed RPC reads return 503 without claiming non-ownership. T3 `SourcePin` chain, collection, token ID and URI can be checked against this observation. Client wallet lists and preview labels never authorize it. A new read occurs for every ownership request, so transfer after login changes the answer. This is a read-only status check, not an endpoint that grants publishing permission. The time between a read and a future storage commit cannot be atomic; T5 must recheck close to the commit.

Vite dev/preview serves these endpoints only on `localhost` or `127.0.0.1`. Its bounded in-memory nonce and session store is for local development and automated acceptance, and it resets when the server restarts. The Vercel `/api/auth` and `/api/owner` adapters intentionally return 503 until T5 supplies a durable shared store across instances. Do not deploy or advertise production sign-in until that is complete. No production domain, wallet credential or database secret is needed for local work. Public play and local arrangements keep working during RPC outages. Browser wallet acceptance, contract-account support and a genuine holder sign-in remain unverified.

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
- `src/server` and `api`: restricted cache and local-only wallet sign-in logic, with fail-closed production auth adapters. No privileged credentials or database access.
- `src/chain`: separate exact-collection read-only owner and token URI checks. No NFT custody or transfer calls.
- `fixtures/genesis`: authentic public-data previews and provenance, never genuine holder publications.
- `src/ui`: development controls and labelled debug canvas.
- `tests`: source integrity, image bounds, actual HTTP routing, causal chain/trait swaps, repeatability, physics, limits and storage checks. The image decode unit tests use a bitmap stub and do not establish WebGL acceptance.

The later server-only publication paths and shared auth persistence are not implemented. The six-day plan uses Vercel server functions, not a second service or multi-package workspace. Do not expose privileged keys in Vite code or unrestricted asset fetchers.

## Engine choice

Direct dependencies are exact-pinned and the pnpm lockfile pins transitive resolution. React 19.3.0, Vite 8.3.4, PixiJS 8.22.0 and Rapier 2D compat 0.21.0 were selected from established releases. TypeScript 6.0.2 stays inside typescript-eslint 8.71.1's supported compiler range. Vite and PixiJS use MIT licences, React uses MIT, TypeScript and Rapier use Apache-2.0.

The normal Rapier package was probed first. Vite's browser library build passed, but Vitest's Node resolver could not resolve its package entry. The compat package gives the browser and Node tests the same asynchronously initialized engine without a custom loader. It embeds WASM and is lazy-loaded separately from the shell, with a significant first-canvas download. Revisit the normal package if this affects the demo's loading budget. Do not claim a smaller bundle until it is measured.

## Canonical plan

[Notion project hub](https://app.notion.com/p/3f3c5381831281e9b8d8e4f7fdb8e322)

[Build](https://app.notion.com/p/3f3c5381831281718d4ada67960ba5a4) · [Tasks](https://app.notion.com/p/3f3c5381831281f8b8bbc290b0de3e03) · [Handoff](https://app.notion.com/p/3f3c538183128181bc4fc6c482e4b04c)

T1/T2 and the technical first-playable gate passed recorded Chrome acceptance. T3 provides the reusable domain/part contract. T4 adds local EOA sign-in and fresh read-only ownership checks; T5 adds durable auth storage and content-bound publication infrastructure. First-time comprehension and voluntary repeat interest remain unvalidated. Final visual design and genuine holder participation remain external gates.
