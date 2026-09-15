# The Excavatorium plugin

This package points to the production OAuth 2.1 MCP server:

`https://the-excavatorium.lovable.app/mcp`

The server exposes bounded, owner-scoped archive and Custodian tools:

- `archive_stats`
- `search` and compatibility alias `list_records`
- `fetch` and compatibility alias `get_record`
- `get_context`
- `compare_records`
- `list_cases`, `get_case`, and `get_findings` when the owner-RLS case foundation is available
- `get_pending_approvals` and `get_run` when the Custodian runtime foundation is available
- `excavate_document`, the explicit supplied-file excavation/save exception that can persist a Document
- `start_analysis` and `cancel_run`, which remain unavailable capability boundaries and never fake execution

The ordinary archive and Custodian retrieval tools are read-oriented. Archive mutation is not generally
exposed; `excavate_document` is the explicit persistence exception. Custodian run controls remain
unavailable while provider execution is disabled.

The package also includes the `custodian` skill for retrieval discipline, source classification, contradiction analysis, connector staging, and approval boundaries.

Record retrieval uses the five canonical types: `tool`, `repository`, `conversation`, `decision`, and `document`. Safe projections omit user ids, seed keys, document storage paths, and raw conversation transcripts by default.

## Finish the ChatGPT connection

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
2. Open **Plugins**, select **+**, and create a connection using the URL above.
3. Complete the Supabase sign-in and consent screen.

The package is linked to the existing ChatGPT app connection. The corrected production consent callback is `/oauth/consent`.

The endpoint advertises protected-resource metadata at
`/.well-known/oauth-protected-resource`, and Supabase publishes the OAuth authorization server metadata, PKCE support, and dynamic-client-registration endpoint.
