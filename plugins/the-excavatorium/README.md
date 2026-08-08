# The Excavatorium plugin

This package points to the production OAuth 2.1 MCP server:

`https://the-excavatorium.lovable.app/mcp`

The server exposes only the signed-in user's archive through three read-only tools:

- `archive_stats`
- `list_records`
- `get_record`

## Finish the ChatGPT connection

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
2. Open **Plugins**, select **+**, and create a connection using the URL above.
3. Complete the Supabase sign-in and consent screen.

The package is linked to the existing ChatGPT app connection. The corrected production consent callback is `/oauth/consent`.

The endpoint advertises protected-resource metadata at
`/.well-known/oauth-protected-resource`, and Supabase publishes the OAuth authorization server metadata, PKCE support, and dynamic-client-registration endpoint.
