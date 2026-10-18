# Chogmog

Make mischief move.

This private repository currently contains **T0 only**, a neutral development canvas with a real Rapier falling body, Run/Pause/Reset, editable starting arrangement and local recovery. It is not the final product UI or the trait-powered game. NFT metadata, artwork, wallet access, holder publication, saved public machines and payments are not connected.

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
pnpm build
# All checks, in order:
pnpm check
```

Clean-checkout acceptance uses `pnpm install --frozen-lockfile` followed by `pnpm check`. GitHub Actions runs those commands on Node 24. There are no additional pre-commit hooks.

## Harness contract

- Real 2D rigid-body physics at 60 fixed steps per second. One ball and one fixed floor, with stable logical IDs and a 720-tick/12-second simulation budget.
- A frame performs at most six physics steps. Excess wall time after a stall is discarded. The harness pauses when the browser tab is hidden.
- Reset rebuilds the world and clears tick, velocity and accumulated time while preserving the selected arrangement. Changing any control resets the world too.
- Arrangement-only settings are validated and stored under `chogmog:falling-scene:v1`. Corrupt, oversized or unavailable storage falls back safely. This is local debug storage, not durable product drafts or publication.
- WASM and the Pixi renderer initialize asynchronously. Controls stay disabled until ready. Unmount/cancel frees the world, renderer, ticker and visibility listener.
- The scene is intentionally plain. Nothing in it demonstrates Genesis ownership, trait essentiality, genuine holder publication or a mainnet transfer.

## Structure

- `src/domain`: bounded development scene and local arrangement serialization. Full scene/part schemas remain T3.
- `src/game`: isolated physics, fixed-step clock and Pixi renderer adapter. Tests use the actual WASM engine, not mocked movement.
- `src/ui`: development controls and labelled debug canvas.
- `tests`: causal fall/contact, repeatability, reset, run limits, clock and storage checks.

The later `src/chain`, `api` and `fixtures/public-metadata` folders should be added with their implementations. The six-day plan uses Vercel server functions and server-only Supabase access, not a second service or multi-package workspace. Do not expose privileged keys in Vite code or unrestricted asset fetchers.

## Engine choice

Direct dependencies are exact-pinned and the pnpm lockfile pins transitive resolution. React 19.3.0, Vite 8.3.4, PixiJS 8.22.0 and Rapier 2D compat 0.21.0 were selected from established releases. TypeScript 6.0.2 stays inside typescript-eslint 8.71.1's supported compiler range. Vite and PixiJS use MIT licences, React uses MIT, TypeScript and Rapier use Apache-2.0.

The normal Rapier package was probed first. Vite's browser library build passed, but Vitest's Node resolver could not resolve its package entry. The compat package gives the browser and Node tests the same asynchronously initialized engine without a custom loader. It embeds WASM and is lazy-loaded separately from the shell, with a significant first-canvas download. Revisit the normal package if this affects the demo's loading budget. Do not claim a smaller bundle until it is measured.

## Canonical plan

[Notion project hub](https://app.notion.com/p/3f3c5381831281e9b8d8e4f7fdb8e322)

[Build](https://app.notion.com/p/3f3c5381831281718d4ada67960ba5a4) · [Tasks](https://app.notion.com/p/3f3c5381831281f8b8bbc290b0de3e03) · [Handoff](https://app.notion.com/p/3f3c538183128181bc4fc6c482e4b04c)

Next is T1: authentic public metadata provenance, distinct token/artwork IDs and safe bounded artwork loading. T2 then establishes the repeatable trait-dependent causal chain. Neither task is completed by this harness.
