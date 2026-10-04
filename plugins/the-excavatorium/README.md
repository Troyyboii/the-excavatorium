# The Excavatorium plugin

Source-available under the repository [Business Source License 1.1](../../LICENSE)
(not OSI open source). This package points to the production OAuth 2.1 MCP server:

`https://the-excavatorium.lovable.app/mcp`

The server exposes bounded, owner-scoped archive and Custodian tools:

- `archive_stats`
- `search` and compatibility alias `list_records`, matching title, summary, exact
  tag, and key record data fields, with tag, updatedAfter, projectRoute, and
  cursor filters plus per-record matchedFields
- `fetch` and compatibility alias `get_record`
- `get_context`
- `compare_records`
- `list_tags`, `list_recent`, and `get_decisions` (with its resolved supersedes chain)
- `list_cases`, `get_case`, and `get_findings` when the owner-RLS case foundation is available
- `get_pending_approvals` and `get_run` when the Custodian runtime foundation is available
- `excavate_document`, the explicit supplied-file excavation/save exception that can persist a Document

The ordinary archive and Custodian retrieval tools are read-oriented. Archive mutation is not generally
exposed; `excavate_document` is the explicit persistence exception and the only mutation.

The package also includes the `custodian` skill for retrieval discipline, source classification, contradiction analysis, connector staging, and approval boundaries.

Record retrieval uses the five canonical types: `tool`, `repository`, `conversation`, `decision`, and `document`. Safe projections omit user ids, seed keys, document storage paths, and raw conversation transcripts by default.

## Client policy

Two server env vars control which OAuth clients may call the server, enforced
identically at the MCP request gate and in the `document-fetch` Edge Function:

- `MCP_CLIENT_POLICY` — `allowlist` (default when unset) or `consent`.
  - `allowlist`: only clients in `MCP_ALLOWED_CLIENT_IDS` (comma-separated
    OAuth client UUIDs, required) are allowed.
  - `consent`: any verified token whose `client_id`/`azp` is a valid UUID is
    allowed; `MCP_ALLOWED_CLIENT_IDS` is ignored and may be unset. Tokens with
    no client claim are still rejected. Use this only because every client
    reaches the server through the owner consent screen below, which names the
    client and its redirect host before approval.
- `MCP_DENIED_CLIENT_IDS` — optional comma-separated client UUIDs. Applies in
  both modes and wins over every approval: a denied client is rejected even if
  allowlisted (or in consent mode).

Fail-closed rules: an unknown policy, a malformed allowlist (in `allowlist`
mode), or a malformed deny list (empty entries, duplicates, non-UUIDs) rejects
every client. A broken policy answers 500 before any bearer inspection.

Deploy order: set the same values as MCP-host env vars **and** as
`supabase secrets set` values for the Edge Functions, then deploy. Both
enforcement points must agree, or `document-fetch` rejects clients the MCP
route allows (and vice versa).

## Finish the ChatGPT connection

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
2. Open **Plugins**, select **+**, and create a connection using the URL above.
3. Complete the Supabase sign-in and consent screen.

The package is linked to the existing ChatGPT app connection. The corrected production consent callback is `/oauth/consent`.

The endpoint advertises protected-resource metadata at
`/.well-known/oauth-protected-resource`, and Supabase publishes the OAuth authorization server metadata, PKCE support, and dynamic-client-registration endpoint.
