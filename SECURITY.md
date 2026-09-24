# Security

## Supported surface

Report security issues that affect The Excavatorium application source in this
repository, its Supabase migrations and Edge Functions as shipped here, or the
public hosted beta when it is running that source.

## Reporting

Email **dario.juzbasic11@gmail.com** with a clear description, impact, and
reproduction steps when possible. Do **not** open a public GitHub issue for
credential leaks, auth bypasses, or data-isolation failures.

Please include:

- affected commit SHA or release if known
- whether the report is source-only or observed on a hosted project
- redacted evidence only (never paste live API keys, JWTs, service-role keys,
  wrapping keys, or other owners' data)

## Secrets and keys

- Browser env may hold only public Supabase URL + publishable key
  (see [`.env.example`](./.env.example)).
- Owner OpenAI keys are BYOK: submitted once to `provider-key`, stored as
  ciphertext, used only inside trusted Edge runtimes. There is no shared
  operator `OPENAI_API_KEY` fallback on Custodian, Conversation Excavation, or
  File Excavation production paths.
- Never commit `.env`, service-role keys, `PROVIDER_KEY_ENCRYPTION_KEYS`,
  OAuth client secrets, SMTP credentials, or private Archive/account exports.

## Scope notes

- MCP Custodian start/cancel remains intentionally unavailable
  (`RUNTIME_UNAVAILABLE`); do not treat that as a bypass target for spend.
- Hosted Auth settings (signup, SMTP, CAPTCHA, redirects) are operator-controlled
  and may lag this repository; see [`docs/public-readiness.md`](./docs/public-readiness.md).
