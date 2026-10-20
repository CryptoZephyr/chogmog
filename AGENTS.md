# Chogmog implementation rules

- Read the canonical Notion Build, Tasks and current Handoff linked from README before starting a slice. Update Tasks and Handoff with actual commands, code references, evidence and the exact next task after a milestone.
- Keep the repository private. Final product design belongs to the owner. The neutral development harness is not an approved final UI.
- Use the single TypeScript package, Node 24, pnpm and exact direct dependency versions. Run `pnpm check` before opening a PR. Do not skip any installed hooks.
- Keep simulation, rendering, domain data, chain reads and persistence separate. Use fixed-step simulation, stable IDs, bounded scenes and allowlisted actions, never arbitrary user scripts.
- Preserve free non-holder play/composition and immutable published source versions/credits. Future holder publication requires fresh ownership, no NFT custody or purchase.
- Public metadata fixtures establish app logic, not ownership. Label preview-holder mode and exclude it from genuine publication and reuse counts. Test causal behaviour, repeatability and meaningful trait removal before declaring the first playable complete.
- Keep credentials, raw signatures and privileged database keys out of source, browser bundles, logs and documentation. Never add an unrestricted artwork proxy.
- No deployment, paid infrastructure, payment or final branding is part of T0. Genuine holder evidence and owner UI direction remain external gates. No mainnet/payment claim without matching on-chain evidence.
