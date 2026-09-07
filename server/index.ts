#!/usr/bin/env node
/**
 * ZONT Control MCP Server
 *
 * Exposes ZONT smart-home / heating control (https://my.zont.online) over MCP,
 * talking to the ZONT REST API v3 (https://my.zont.online/api/widget/v3).
 *
 * Auth: token-only. Set ZONT_TOKEN to a token minted via POST /authtokens
 * (Basic Auth with your ZONT login/password, one-time only -- see README.md).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://my.zont.online/api/widget/v3";

const ZONT_TOKEN = process.env.ZONT_TOKEN;
const ZONT_CLIENT_EMAIL = process.env.ZONT_CLIENT_EMAIL;

if (!ZONT_TOKEN) {
  console.error(
    "[zont-control] ZONT_TOKEN is not set. Every tool call will fail until it is configured.",
  );
}
if (!ZONT_CLIENT_EMAIL) {
  console.error(
    "[zont-control] ZONT_CLIENT_EMAIL is not set. ZONT's API requires an X-ZONT-Client " +
      "contact header on every request and will reject calls without it.",
  );
}

type JsonRecord = Record<string, unknown>;

async function zontRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { query?: Record<string, unknown>; body?: JsonRecord } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = new URL(API_BASE + path);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (ZONT_TOKEN) headers["X-ZONT-Token"] = ZONT_TOKEN;
  if (ZONT_CLIENT_EMAIL) headers["X-ZONT-Client"] = ZONT_CLIENT_EMAIL;

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url.toString(), { method, headers, body });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function toToolResult(result: { ok: boolean; status: number; data: unknown }) {
  const payload = { http_status: result.status, ...((result.data as JsonRecord) ?? {}) };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: !result.ok || (result.data as JsonRecord)?.ok === false,
  };
}

const server = new McpServer({
  name: "zont-control",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// State: read devices / circuits / modes / sensors / guard zones / scenarios
// ---------------------------------------------------------------------------

const FIELD_ENUM = z
  .enum([
    "modes",
    "car_state",
    "scenarios",
    "sim_info",
    "controls",
    "guard_zones",
    "circuits",
    "sensors",
  ])
  .describe(
    "Which optional sections to include. Omit to receive every section.",
  );

server.registerTool(
  "zont_get_devices",
  {
    title: "List ZONT devices and their state",
    description:
      "Get every ZONT/Mega SX device on the account with its current state: heating circuits, " +
      "boiler, modes, sensors, guard zones, scenarios, and custom controls. Optionally filter to " +
      "specific device IDs or specific data sections.",
    inputSchema: {
      device_ids: z
        .array(z.number().int())
        .optional()
        .describe("Restrict to these device IDs. Omit for all devices on the account."),
      fields: z
        .array(FIELD_ENUM)
        .optional()
        .describe("Restrict the response to these sections. Omit for everything."),
    },
  },
  async ({ device_ids, fields }) => {
    const result = await zontRequest("GET", "/devices", {
      query: { device_ids, fields },
    });
    return toToolResult(result);
  },
);

server.registerTool(
  "zont_get_device",
  {
    title: "Get one ZONT device's state",
    description:
      "Get the full state of a single ZONT/Mega SX device by its numeric device ID: heating " +
      "circuits, boiler, modes, sensors, guard zones, scenarios, and custom controls.",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID (see zont_get_devices)."),
    },
  },
  async ({ device_id }) => {
    const result = await zontRequest("GET", `/devices/${device_id}`);
    return toToolResult(result);
  },
);

// ---------------------------------------------------------------------------
// Control: heating, modes, guard, scenarios, custom controls
// ---------------------------------------------------------------------------

server.registerTool(
  "zont_set_target_temp",
  {
    title: "Set target temperature for a heating circuit",
    description:
      "Set the target temperature of a heating circuit and switch it to manual control. This " +
      "overrides whatever heating mode the circuit was following. Use zont_get_devices first to " +
      "find the device_id and the circuit's entity_id (in the device's `circuits` list).",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID."),
      circuit_id: z
        .number()
        .int()
        .describe("The heating circuit's entity ID (Circuit.id from zont_get_devices)."),
      target_temp: z.number().describe("Desired target temperature, °C."),
    },
  },
  async ({ device_id, circuit_id, target_temp }) => {
    const result = await zontRequest(
      "POST",
      `/devices/${device_id}/circuits/${circuit_id}/actions/target-temp`,
      { body: { target_temp } },
    );
    return toToolResult(result);
  },
);

server.registerTool(
  "zont_activate_heating_mode",
  {
    title: "Activate a heating mode",
    description:
      "Activate a heating mode (e.g. Комфорт/Comfort, Эконом/Eco) on a device. Applies to all " +
      "circuits by default, or to a single circuit if circuit_id is given (device must support " +
      "per-circuit modes). Overwrites any manually set target temperature. Optionally set a " +
      "duration (minutes) or a schedule (UTC hour/minute) for when the mode should start.",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID."),
      mode_id: z
        .number()
        .int()
        .describe("The heating mode's entity ID (Mode.id from zont_get_devices)."),
      circuit_id: z
        .number()
        .int()
        .optional()
        .describe("Limit activation to this circuit instead of applying globally."),
      duration: z.number().int().optional().describe("Duration of the mode, in minutes."),
      schedule: z
        .object({
          hour: z.number().int().min(0).max(23),
          minute: z.number().int().min(0).max(59),
        })
        .optional()
        .describe("Timer for when to activate the mode, in UTC+0."),
    },
  },
  async ({ device_id, mode_id, circuit_id, duration, schedule }) => {
    const body: JsonRecord = {};
    if (circuit_id !== undefined) body.circuit_id = circuit_id;
    if (duration !== undefined) body.duration = duration;
    if (schedule !== undefined) body.schedule = schedule;
    const result = await zontRequest(
      "POST",
      `/devices/${device_id}/modes/${mode_id}/actions/activate`,
      { body },
    );
    return toToolResult(result);
  },
);

server.registerTool(
  "zont_set_guard",
  {
    title: "Arm or disarm a guard zone",
    description:
      "Arm or disarm a security/guard zone on a device. Use zont_get_devices first to find the " +
      "zone's entity_id (in the device's `guard_zones` list).",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID."),
      zone_id: z
        .number()
        .int()
        .describe("The guard zone's entity ID (GuardZone.id from zont_get_devices)."),
      enable: z.boolean().describe("true to arm the zone, false to disarm it."),
    },
  },
  async ({ device_id, zone_id, enable }) => {
    const result = await zontRequest(
      "POST",
      `/devices/${device_id}/guard-zones/${zone_id}/actions/activate`,
      { body: { enable, zone_id } },
    );
    return toToolResult(result);
  },
);

server.registerTool(
  "zont_run_scenario",
  {
    title: "Run a preset scenario",
    description:
      "Trigger a preset scenario on a device. Use zont_get_devices first to find the scenario's " +
      "entity_id (in the device's `scenarios` list).",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID."),
      scenario_id: z
        .number()
        .int()
        .describe("The scenario's entity ID (Scenario.id from zont_get_devices)."),
    },
  },
  async ({ device_id, scenario_id }) => {
    const result = await zontRequest(
      "POST",
      `/devices/${device_id}/scenarios/${scenario_id}/actions/activate`,
    );
    return toToolResult(result);
  },
);

server.registerTool(
  "zont_trigger_button",
  {
    title: "Press a custom button or toggle",
    description:
      "Activate a user-defined control on a device: a simple button (single press) or a toggle " +
      "button (pass target_state). Use zont_get_devices first to find the control's entity_id (in " +
      "the device's `controls.buttons` or `controls.toggle_buttons` list).",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID."),
      control_id: z
        .number()
        .int()
        .describe("The control's entity ID (Button.id or ToggleButton.id)."),
      target_state: z
        .boolean()
        .optional()
        .describe("Required for toggle buttons: true to activate, false to deactivate."),
    },
  },
  async ({ device_id, control_id, target_state }) => {
    const body: JsonRecord = {};
    if (target_state !== undefined) body.target_state = target_state;
    const result = await zontRequest(
      "POST",
      `/devices/${device_id}/controls/${control_id}/actions/trigger`,
      { body },
    );
    return toToolResult(result);
  },
);

server.registerTool(
  "zont_set_regulator",
  {
    title: "Set an analog regulator's value",
    description:
      "Set the output value of an analog regulator (e.g. a 0-10V output), in the regulator's own " +
      "unit (V, Hz, °C -- see Regulator.unit). Use zont_get_devices first to find the regulator's " +
      "entity_id and its min/max/step (in the device's `controls.regulators` list).",
    inputSchema: {
      device_id: z.number().int().describe("The device's numeric ID."),
      regulator_id: z.number().int().describe("The regulator's entity ID (Regulator.id)."),
      target_value: z.number().describe("Desired value, in the regulator's unit."),
    },
  },
  async ({ device_id, regulator_id, target_value }) => {
    const result = await zontRequest(
      "POST",
      `/devices/${device_id}/controls/${regulator_id}/actions/set-voltage`,
      { body: { target_value } },
    );
    return toToolResult(result);
  },
);

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[zont-control] MCP server running on stdio");
