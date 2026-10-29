# Dreo Humidifier Card

A Home Assistant Lovelace card for **Dreo humidifiers** exposed through [`hass-dreo`](https://github.com/jeffsteinbok/hass-dreo). It puts the mode, target humidity, mist level, light and sound settings, and maintenance info in one card, styled with Material 3 Expressive and themed by the [Material You theme](https://github.com/Nerwyn/material-you-theme) when you use it.

It's a sibling of [ha-card-dyson-pure-humidify-cool](https://github.com/brycewc/ha-card-dyson-pure-humidify-cool) and shares its look and behavior.

## Compatibility

Built and tested on a Dreo 524S (DR-HHM004S) with `hass-dreo` 1.11.11. Other Dreo humidifiers (DR-HHM\*) are likely to work, but may expose different entities or modes. If you try one, `npm run test:live` reports any entity or attribute the card doesn't expect, and an issue with that output is welcome.

## What it does

The header (with the power button), any alerts, and the humidity, mist, and water tank tiles are always visible. Everything else sits under a **Controls** disclosure that starts collapsed.

- **Readings:** room humidity (highlighted once the target is reached), the current mist level (or **Paused** when Auto or Sleep has reached the target), and the water tank state.
- **Humidify:** Manual, Auto, or Sleep.
  - **Manual** runs at a fixed mist level: Low, Medium, or High.
  - **Auto** holds a target humidity from 30% to 90%, in 5% steps by default.
  - **Sleep** has its own target, kept separate from Auto's, which the card writes through the sleep target entity so it lands correctly right after a mode change.
- **Settings:** ambient light, display, panel sound, and the Dreo app schedule, plus the humidity thresholds where the ambient light ring changes color.
- **Maintenance:** filter life and run time since the last cleaning.
- **Alerts:** banners for an empty water tank and a filter at 10% or less.

The integration doesn't expose a sleep timer or filter reset for this model, so the card doesn't offer them. The Fog Level number writes the same device value as the Mist Level select, so the card only uses it on models without the select.

## Install

### HACS (custom repository)

1. HACS → menu → **Custom repositories** → add `https://github.com/brycewc/ha-card-dreo-humidifier` as a **Dashboard**.
2. Install **Dreo Humidifier Card** and reload the browser.

Releases attach the built `dreo-humidifier-card.js` file, which HACS installs.

### Manual

1. Download `dreo-humidifier-card.js` from the latest release, or build it with `npm run build`.
2. Copy it to `/config/www/dreo-humidifier-card.js`.
3. Add a dashboard resource: Settings → Dashboards → ⋮ → Resources → `/local/dreo-humidifier-card.js?v=1.0.0`, type **JavaScript module**. Bump `?v=` when you update the file.

## Configuration

```yaml
type: custom:dreo-humidifier-card
entity: humidifier.office_humidifier
```

| Option             | Default     | Description                                                                                                                                         |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity`           | required    | The `hass-dreo` humidifier entity. Every other entity is found from the same device.                                                                |
| `title`            | device name | Header title.                                                                                                                                       |
| `humidity_step`    | `5`         | Step for the target humidity slider, in percent.                                                                                                    |
| `show_settings`    | `true`      | Shows the Settings panel.                                                                                                                           |
| `show_maintenance` | `true`      | Shows the Maintenance panel.                                                                                                                        |
| `entities`         | `{}`        | Overrides for any discovered entity, for example `{ humidity: sensor.office_humidity }`. Keys are listed in [src/entities.ts](src/entities.ts). |

The visual editor covers everything except `entities`.

## Theming

The card reads Material Design 3 tokens (`--md-sys-color-*`, `--md-sys-shape-corner-*`, `--md-sys-typescale-*`) when the Material You theme provides them. With any other theme it falls back to the standard HA variables (`--primary-color`, `--card-background-color`, `--divider-color`, and so on). It has no hard-coded light or dark palette: your HA theme decides.

Motion uses M3 Expressive springs (approximated with CSS `linear()`) and is disabled when the OS asks for reduced motion.

## Development

Requires Node 22 or newer.

```bash
npm install
npm run dev          # harness at http://localhost:5173/dev/ with mock data
npm test             # unit tests (offline)
npm run typecheck
npm run build        # dist/dreo-humidifier-card.js
```

### Working against your live Home Assistant

Copy `.env.example` to `.env.local` and fill in `HA_URL` and a long-lived access token (HA → Profile → Security). `.env.local` is gitignored. The token is only read by Node and the dev server, and a test fails the build if it ever ends up in `dist/`.

| Command                          | What it does                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:live`               | Opens the harness on live data through a Vite proxy. **Writes are dry runs until you tick "Arm writes".**                                                                                           |
| `npm run test:live`              | Read-only contract tests: every entity is found, attribute shapes and service names match what the card expects, and the card renders live data. The connection refuses anything that isn't a read. |
| `npm run snapshot`               | Refreshes `test/fixtures/` from the live device (read-only). The serial, device ID and IP addresses are replaced with placeholders before anything is written.                                       |
| `npm run ha:dev-resource -- add` | Adds the dev build as a dashboard resource and creates an admin-only "Dreo Dev" dashboard. `remove` undoes both, `status` shows what's installed.                                                    |
| `npm run dev:ha`                 | Watch-builds `custom:dreo-humidifier-card-dev` and serves it to HA at `http://<your-mac>.local:5174/`. Refresh the HA tab after each rebuild.                                                       |

The dev card uses a separate tag, so it can run alongside the installed card. Clients that can't reach your Mac (a phone off Wi-Fi, or HA over HTTPS) show a load error for the dev card only. Run `ha:dev-resource -- remove` when you're done.

## License

Apache-2.0. See [LICENSE](LICENSE).
