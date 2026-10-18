# Chogmog

Make mischief move.

This private repository contains the T0 physics foundation and a T1/T2 first-chain preview using authentic Genesis metadata and artwork. The playable sequence is ball release, laser sensor, balloon pop, physical confetti lift, portal, lever contact and a chosen message. It supports Run/Pause/Reset, source swaps, geometry edits and local arrangement recovery.

The original T0 harness passed recorded Chrome acceptance. T1/T2 have automated causal, source and HTTP-route coverage, but their browser/WebGL acceptance is still pending. Wallet access, genuine holder publication, durable public machines, payments and production deployment are not connected. Public-data previews prove neither ownership nor holder permission.

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

`fixtures/genesis` preserves the original JSON and WebP bytes, plus a provenance manifest containing original IPFS URIs, chain, collection, observed block, retrieval time and SHA-256 hashes. Read-only `eth_chainId` returned `0x8f` and `eth_call` for `tokenURI(846)` and `tokenURI(533)` at block `0x6d1a34c` confirmed the distinct artwork mappings. No ownership or signature checks were performed.

Primary retrieval was `https://ipfs.filebase.io/ipfs/<CID>/<artwork>.<extension>`. The two CIDs are recorded in the manifest. Requests were bounded with `curl --fail --show-error --silent --max-time 60`. Gateway delays were observed, so runtime delivery uses the prewarmed, hash-pinned local cache rather than relying on a live gateway or arbitrary URL fallback.

`GET /api/source?kind=artwork&id=338` and the equivalent metadata request serve only the two allowlisted entries. Vite dev/preview and the Node function share the handler. No user URL, arbitrary CID, redirect or upstream fetch is accepted. Cache files are hash-checked, responses are same-origin and `nosniff`, metadata is limited to 16 KiB, and images to 1 MiB and 1024 pixels per dimension. The browser verifies the digest and supported WebP header before decode and uses a four-second fetch deadline. The current previews are 1000×1000 WebP, 264448 and 301120 bytes.

The renderer loads those same-origin bytes into Pixi textures, releases bitmaps/textures on disposal and retains geometry when image loading fails. Actual browser texture upload, canvas origin cleanliness and cold-start timing remain unverified for this slice. Export is out of scope.

`api/source.ts` is a Vercel Node Web-standard handler. `vercel.json` includes the pinned cache in a future function bundle. A plain static upload of `dist/` alone will not serve the asset route. This deployment adapter has not been deployed or verified on Vercel.

## Original T0 harness contract

- Real 2D rigid-body physics at 60 fixed steps per second. One ball and one fixed floor, with stable logical IDs and a 720-tick/12-second simulation budget.
- A frame performs at most six physics steps. Excess wall time after a stall is discarded. The harness pauses when the browser tab is hidden.
- Reset rebuilds the world and clears tick, velocity and accumulated time while preserving the selected arrangement. Changing any control resets the world too.
- Arrangement-only settings are validated and stored under `chogmog:falling-scene:v1`. Corrupt, oversized or unavailable storage falls back safely. This is local debug storage, not durable product drafts or publication.
- WASM and the Pixi renderer initialize asynchronously. Controls stay disabled until ready. Unmount/cancel frees the world, renderer, ticker and visibility listener.
- The scene is intentionally plain. Nothing in it demonstrates Genesis ownership, trait essentiality, genuine holder publication or a mainnet transfer.

## Structure

- `src/domain`: source parsing, trait compilation, bounded arrangements, artwork validation and local recovery. Full scene/part schemas remain T3.
- `src/game`: isolated physics, causal chain, fixed-step clock and Pixi renderer adapters. Tests use the actual WASM engine, not mocked movement.
- `src/server` and `api`: restricted cache response logic and the future Node deployment entry point. No privileged credentials or database access.
- `fixtures/genesis`: authentic public-data previews and provenance, never genuine holder publications.
- `src/ui`: development controls and labelled debug canvas.
- `tests`: source integrity, image bounds, actual HTTP routing, causal chain/trait swaps, repeatability, physics, limits and storage checks. The image decode unit tests use a bitmap stub and do not establish WebGL acceptance.

The later `src/chain` wallet reads and server-only Supabase publication paths are not implemented. The six-day plan uses Vercel server functions, not a second service or multi-package workspace. Do not expose privileged keys in Vite code or unrestricted asset fetchers.

## Engine choice

Direct dependencies are exact-pinned and the pnpm lockfile pins transitive resolution. React 19.3.0, Vite 8.3.4, PixiJS 8.22.0 and Rapier 2D compat 0.21.0 were selected from established releases. TypeScript 6.0.2 stays inside typescript-eslint 8.71.1's supported compiler range. Vite and PixiJS use MIT licences, React uses MIT, TypeScript and Rapier use Apache-2.0.

The normal Rapier package was probed first. Vite's browser library build passed, but Vitest's Node resolver could not resolve its package entry. The compat package gives the browser and Node tests the same asynchronously initialized engine without a custom loader. It embeds WASM and is lazy-loaded separately from the shell, with a significant first-canvas download. Revisit the normal package if this affects the demo's loading budget. Do not claim a smaller bundle until it is measured.

## Canonical plan

[Notion project hub](https://app.notion.com/p/3f3c5381831281e9b8d8e4f7fdb8e322)

[Build](https://app.notion.com/p/3f3c5381831281718d4ada67960ba5a4) · [Tasks](https://app.notion.com/p/3f3c5381831281f8b8bbc290b0de3e03) · [Handoff](https://app.notion.com/p/3f3c538183128181bc4fc6c482e4b04c)

Next is recorded browser acceptance of T1/T2: fresh origin, both authentic textures, the causal chain, each trait swap, deliberate geometry edits, message/reset, saved reload, hidden-tab pause and unavailable-art fallback. Keep T1/T2 and Gate A open until that evidence exists. T3 then freezes the reusable domain/part schemas. Final visual design and genuine holder participation remain external gates.
