## Summary

## Verification

- [ ] `bun run lint` / `typecheck` / `bun test src` (as applicable)
- [ ] Edge Deno tests if functions changed
- [ ] No secrets, `.env`, or private exports in the diff

## Hosted / operator

This PR does **not** apply migrations, set secrets, deploy Edge Functions, call
OpenAI, or mutate production unless an authorized operator explicitly does so
outside the PR.
