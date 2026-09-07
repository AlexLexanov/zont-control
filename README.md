# ZONT Control

Read and control your ZONT smart-home heating devices (my.zont.online) from Claude, via the
official ZONT REST API v3.

## Components

- **MCP server** (`server/index.mjs`) — a self-contained (no `npm install` needed) stdio MCP
  server, bundled from `server/index.ts`. Exposes 8 tools:
  - `zont_get_devices`, `zont_get_device` — read device/circuit/sensor/mode/guard-zone state
  - `zont_set_target_temp`, `zont_activate_heating_mode` — control heating
  - `zont_set_guard` — arm/disarm a guard zone
  - `zont_run_scenario` — trigger a preset scenario
  - `zont_trigger_button`, `zont_set_regulator` — custom controls/analog outputs
- **Skill** (`skills/zont-heating`) — teaches Claude how to sequence these tools (always read state
  before writing, respect min/max/step, surface boiler faults and offline devices, etc.).

## Setup: getting your ZONT API token

The MCP server authenticates to ZONT with a long-lived API token (`X-ZONT-Token` header) — your
ZONT password is never given to Claude or stored anywhere in this plugin.

You mint the token **yourself**, once, using your ZONT login/password directly against ZONT's own
API (Claude never sees the password):

1. Open ZONT's interactive API docs in your browser: **https://my.zont.online/widget-api/v2** (or
   the newer `https://my.zont.online/api/widget/v3` — same flow) and log in to my.zont.online in
   the same browser first if you haven't.
2. Click **Authorize**, and enter your ZONT login/password there (this stays local to your
   browser's request to ZONT).
3. Open `POST /authtokens`, click **Try it out**, set the body to
   `{"client_name": "zont-control mcp"}`, and click **Execute**.
4. Copy the `token` value from the response. **It is shown once** — if you lose it, revoke it
   (`DELETE /authtokens/{token_id}`) and mint a new one.

Alternatively, from a terminal (replace `LOGIN`/`PASSWORD`):

```bash
curl -X POST https://my.zont.online/api/widget/v3/authtokens \
  -u "LOGIN:PASSWORD" \
  -H "X-ZONT-Client: your-email@example.com" \
  -H "Content-Type: application/json" \
  -d '{"client_name": "zont-control mcp"}'
```

## Setup: configuring the plugin

Two environment variables must be set wherever this plugin's MCP server runs:

| Variable            | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `ZONT_TOKEN`         | The token from the step above.                                     |
| `ZONT_CLIENT_EMAIL`  | Your contact email. ZONT's API rejects requests without this header. |

Set them in your shell profile (or wherever your Claude/Cowork host reads plugin environment
variables from) before the server starts, e.g.:

```bash
export ZONT_TOKEN="the-token-you-copied"
export ZONT_CLIENT_EMAIL="your-email@example.com"
```

The server runs via `bun` (matches this plugin's stack) directly against the bundled
`server/index.mjs` — no build step or `npm install` required. Plain Node.js (`node`) works too if
you'd rather not depend on Bun; just change `command` in `.mcp.json` from `bun` to `node`.

## Rebuilding the server

Source lives at `server/index.ts` (uses `@modelcontextprotocol/sdk` + `zod`). To rebuild
`server/index.mjs` after editing it:

```bash
npm install @modelcontextprotocol/sdk zod esbuild
npx esbuild server/index.ts --bundle --platform=node --format=esm --target=node18 \
  --outfile=server/index.mjs
```

## Notes

- Device/circuit/mode/zone/scenario/control IDs are account-specific — always call
  `zont_get_devices` to discover current IDs rather than hardcoding them.
- `zont_set_target_temp` and `zont_activate_heating_mode` both change what the device is actually
  doing (real heating changes) — the skill instructs Claude to confirm before vague requests.
- ZONT also has an older, deprecated Widget API v2 and a legacy API v1 (Basic Auth only, wider
  scope including GPS/vehicle for ZTC devices) — this plugin targets v3, the current one.
