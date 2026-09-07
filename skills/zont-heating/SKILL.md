---
name: zont-heating
description: >
  This skill should be used when the user asks to "check the heating",
  "check the boiler", "what's the temperature at the cottage", "set the
  thermostat", "change the heating mode", "arm/disarm the alarm at the
  house", "run a ZONT scenario", or otherwise wants to read or control
  their ZONT smart-home heating system via the zont-control MCP tools.
metadata:
  version: "0.1.0"
---

Use the `zont_*` MCP tools (from the `zont-control` server) to read and control the user's ZONT
heating/smart-home devices. Follow this sequence:

## 1. Always discover before acting

Call `zont_get_devices` (or `zont_get_device` for a known device_id) first, even if you already
called it earlier in the conversation — device state changes in real time (temperatures, online
status, current mode). Never guess a `circuit_id`, `mode_id`, `zone_id`, `scenario_id`, or
`control_id` — read it from the device's `circuits`, `modes`, `guard_zones`, `scenarios`, or
`controls` lists returned by `zont_get_devices`.

If the device is `online: false`, warn the user before attempting a control action — commands to
an offline device will fail or time out.

## 2. Reading state

- Temperatures are Celsius, in `circuits[].actual_temp` (current) and `circuits[].target_temp`.
- A circuit with `current_mode: null` is in manual mode (temperature was set directly, not by a
  heating mode).
- `circuits[].type` distinguishes the boiler circuit (`boiler`) from room/zone circuits
  (`consumer`, `cooling`, `dhw` for hot water).
- Boiler faults surface in `circuits[].error` (`oem` code + human-readable `text`) — surface these
  to the user plainly if present, they usually mean the boiler needs attention.
- Sensor readings (`sensors[]`) include a `status` field — `alarm` or `failure` are worth calling
  out, not just the raw `value`.

## 3. Changing temperature or mode

- `zont_set_target_temp` overrides whatever mode a circuit is in and switches it to manual control
  — tell the user this is happening if they didn't ask for manual mode explicitly.
- `zont_activate_heating_mode` re-applies a named mode (e.g. Комфорт/Comfort, Эконом/Eco) and wipes
  any manual temperature override on the circuits it applies to. Omit `circuit_id` to apply to the
  whole device; only pass it if the user wants one room/zone changed and the device supports
  per-circuit modes (check `modes[].can_be_applied` for which circuits accept the mode).
- Respect each circuit's `min`/`max`/`step` when suggesting or setting a temperature — don't send a
  value outside that range.

## 4. Guard zones, scenarios, custom controls

- `zont_set_guard` arms (`enable: true`) or disarms (`enable: false`) a zone. Confirm with the user
  before disarming — that's a security-relevant action.
- `zont_run_scenario` and `zont_trigger_button` are fire-and-forget: they don't take a value except
  `target_state` for toggle-type buttons (`controls.toggle_buttons`) — plain buttons
  (`controls.buttons`) take no body at all.
- `zont_set_regulator` expects a value in the regulator's own unit (`controls.regulators[].unit`,
  e.g. В/Гц/°С) — respect its `min`/`max`/`step`.

## 5. Errors

A response with `"ok": false` carries a machine-readable `error` code and a human `error_ui`
string — prefer relaying `error_ui` to the user, it's already in plain language. Common codes:
`device_is_offline`, `timeout`, `command_ok_confirmation_not_received` (command was sent but the
device hasn't confirmed yet — safe to say "sent, unconfirmed" rather than declaring failure),
`bad_device_response`.

## 6. Confirm before irreversible/consequential actions

Changing heating mode, disarming a guard zone, or running a scenario has a real-world physical
effect (temperature swings, an unarmed house). If the user's instruction is unambiguous, proceed;
if it's a broad or vague request ("make it warmer"), propose a specific value/mode and confirm
before calling the tool, rather than guessing a number.
