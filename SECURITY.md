# Security policy

Thanks for helping keep Chogmog and its players safe.

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately through GitHub instead:

[Report a vulnerability](https://github.com/CryptoZephyr/chogmog/security/advisories/new)

Tell us what you found, how to reproduce it and what someone could do with it. We'll reply as soon as we can and keep you updated until it's fixed. If you'd like credit when the fix ships, say how you'd like to be named.

## What's covered

- The live game at https://chogmog.vercel.app
- The code on the `main` branch of this repo

Older commits and other branches aren't supported.

We especially want to hear about anything that lets someone:

- sign in as another wallet or reuse someone else's session
- publish a part from a Chog they don't own, or change a part or machine after it's published
- remove or change the credits on someone else's work
- make preview parts count as a real holder's work
- read server settings, database contents or other players' sessions

## Please don't

- use real players' wallets, sessions or Chogs in your tests
- publish test parts or machines to the live Gallery
- run load or denial-of-service tests against the live site
- access or change data that isn't yours

Chogmog never asks for a seed phrase, a private key, an NFT approval or a transaction. Signing in is a free message signature. If anything claiming to be Chogmog asks for more than that, please report it.
