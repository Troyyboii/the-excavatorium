# Contributing

Thanks for interest in The Excavatorium. This repository is **source-available
under the Business Source License 1.1** (see [`LICENSE`](./LICENSE)). It is
**not** OSI open source. Personal, internal, and academic use are covered by the
Additional Use Grant; commercial hosting or redistribution needs a separate
license.

## Before you start

1. Read [`README.md`](./README.md) and [`docs/public-readiness.md`](./docs/public-readiness.md)
   for product boundaries (BYOK, beta limits, what source does not deploy).
2. Prefer a small, reviewable change that matches an existing pattern.
3. Do **not** commit secrets, service-role keys, wrapping keys, `.env` files
   (only [`.env.example`](./.env.example)), private Archive exports, or real
   credentials. Never rewrite published Git history (see [`AGENTS.md`](./AGENTS.md)).

## Local checks

```sh
bun install
bun run lint
bun run typecheck
bun test src
bun run mcp:manifest:check
bun run build
```

Edge Function Deno checks (from `supabase/functions`):

```sh
deno task check
deno task test
```

Database pgTAP requires a local Supabase stack; hosted CI runs it. Do not apply
migrations or deploy Edge Functions to the production project from a casual PR.

## Pull requests

- Keep the PR focused; say what is verified locally vs what still needs a
  hosted operator action.
- Do not contact OpenAI, mutate production Auth/Supabase, or change repo
  visibility from a contribution PR.
- Use the issue templates for bugs and security reports when they fit.
