# Changelog

## 1.0.1 - 2026-10-29

### Fixed

- The reading tiles are now the same height as the Dyson Humidify+Cool card's, so the two line up side by side.

## 1.0.0 - 2026-10-29

First release of `custom:dreo-humidifier-card`, built for the Dreo 524S (DR-HHM004S) on `hass-dreo` 1.11.11.

### Added

- Manual, Auto, and Sleep modes, with Low, Medium, and High mist in Manual and separate Auto and Sleep targets.
- Humidity, mist, and water tank tiles, including a paused state once the target is reached.
- Settings for the ambient light, display, panel sound, and Dreo app schedule, plus the light ring's humidity thresholds.
- Maintenance panel with filter life and run time since cleaning.
- Alert banners for an empty water tank and a low filter.
- Dev harness with mock and live data, read-only live contract tests, and a dev build that loads inside a real dashboard.
