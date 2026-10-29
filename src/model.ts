import type { EntityKey, ResolvedEntities } from "./entities";
import type { HassEntity, HomeAssistant } from "./types";

export const MODES = ["normal", "auto", "sleep"] as const;
export type HumidifierMode = (typeof MODES)[number];

export const MODE_LABELS: Record<HumidifierMode, string> = {
  normal: "Manual",
  auto: "Auto",
  sleep: "Sleep",
};

export const LOW_FILTER_PERCENT = 10;

export type AlertTone = "error" | "warning";

export interface Alert {
  id: string;
  entityId: string;
  tone: AlertTone;
  icon: string;
  message: string;
}

export interface Reading {
  entityId?: string;
  value: number | null;
  display: string;
}

export type Mist =
  | { kind: "select"; entityId: string; value: string | null; options: string[] }
  | { kind: "number"; entityId: string; value: number | null; min: number; max: number; step: number };

export interface DreoModel {
  available: boolean;
  name: string;
  deviceName: string;
  power: boolean;
  mode: HumidifierMode | null;
  modes: HumidifierMode[];
  targets: { auto: number | null; sleep: number | null };
  min: number;
  max: number;
  humidity: Reading;
  targetReached: boolean | null;
  mist: Mist | null;
  waterEmpty: boolean | null;
  alerts: Alert[];
  settings: {
    display: boolean | null;
    panelSound: boolean | null;
    schedule: boolean | null;
    ambientLight: boolean | null;
    lightLow: number | null;
    lightHigh: number | null;
  };
  maintenance: {
    filterLife: number | null;
    filterActive: boolean | null;
    useSinceCleaning: number | null;
  };
}

const UNAVAILABLE = new Set(["unavailable", "unknown", ""]);

export function isUsable(entity: HassEntity | undefined): entity is HassEntity {
  return Boolean(entity) && !UNAVAILABLE.has(String(entity!.state).toLowerCase());
}

function numericState(entity: HassEntity | undefined): number | null {
  if (!isUsable(entity)) return null;
  const value = Number(entity.state);
  return Number.isFinite(value) ? value : null;
}

function onOff(entity: HassEntity | undefined): boolean | null {
  if (!isUsable(entity)) return null;
  return entity.state === "on";
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readMist(get: (key: EntityKey) => HassEntity | undefined, resolved: ResolvedEntities): Mist | null {
  const select = get("mistLevel");
  if (select && resolved.ids.mistLevel) {
    return {
      kind: "select",
      entityId: resolved.ids.mistLevel,
      value: isUsable(select) ? select.state : null,
      options: Array.isArray(select.attributes?.options) ? select.attributes.options : [],
    };
  }
  const number = get("fogLevel");
  if (number && resolved.ids.fogLevel) {
    return {
      kind: "number",
      entityId: resolved.ids.fogLevel,
      value: numericState(number),
      min: Math.max(1, Number(number.attributes?.min ?? 1)),
      max: Number(number.attributes?.max ?? 6),
      step: Number(number.attributes?.step ?? 1),
    };
  }
  return null;
}

function readAlerts(model: Pick<DreoModel, "waterEmpty" | "maintenance">, resolved: ResolvedEntities): Alert[] {
  const alerts: Alert[] = [];
  if (model.waterEmpty && resolved.ids.waterEmpty) {
    alerts.push({
      id: "water-empty",
      entityId: resolved.ids.waterEmpty,
      tone: "error",
      icon: "mdi:water-off",
      message: "Water tank empty. Refill it to keep humidifying.",
    });
  }
  const life = model.maintenance.filterLife;
  if (life !== null && life <= LOW_FILTER_PERCENT && resolved.ids.filterLife) {
    alerts.push({
      id: "filter-low",
      entityId: resolved.ids.filterLife,
      tone: "warning",
      icon: "mdi:air-filter",
      message: `Replace the filter soon (${life}% left).`,
    });
  }
  return alerts;
}

export function readModel(hass: HomeAssistant, resolved: ResolvedEntities): DreoModel {
  const states = hass.states;
  const get = (key: EntityKey) => (resolved.ids[key] ? states[resolved.ids[key]!] : undefined);
  const humidifier = states[resolved.humidifier];
  const attributes = humidifier?.attributes ?? {};
  const available = isUsable(humidifier);
  const device = resolved.deviceId ? hass.devices?.[resolved.deviceId] : undefined;

  const rawMode = attributes.mode;
  const mode = (MODES as readonly string[]).includes(rawMode) ? (rawMode as HumidifierMode) : null;
  const advertised: string[] = Array.isArray(attributes.available_modes) ? attributes.available_modes : [];
  const modes = MODES.filter((option) => advertised.includes(option));

  // The entity's humidity attribute is the sleep target in sleep mode and the auto target otherwise.
  const entityTarget = finite(attributes.humidity);
  const sleepNumber = numericState(get("sleepTarget"));
  const targets = {
    auto: mode === "sleep" ? null : entityTarget,
    sleep: sleepNumber ?? (mode === "sleep" ? entityTarget : null),
  };

  const sensorHumidity = numericState(get("humidity"));
  const humidityValue = sensorHumidity ?? finite(attributes.current_humidity);
  const reached = get("targetReached");
  const waterEmpty = onOff(get("waterEmpty"));
  const filterActive = get("filterActive");
  const maintenance = {
    filterLife: numericState(get("filterLife")),
    filterActive: isUsable(filterActive) ? filterActive.state === "active" : null,
    useSinceCleaning: numericState(get("useSinceCleaning")),
  };

  return {
    available,
    name: attributes.friendly_name ?? resolved.humidifier,
    deviceName: device?.name_by_user || device?.name || attributes.friendly_name || "The humidifier",
    power: humidifier?.state === "on",
    mode,
    modes: modes.length ? modes : [...MODES],
    targets,
    min: finite(attributes.min_humidity) ?? 30,
    max: finite(attributes.max_humidity) ?? 90,
    humidity: {
      entityId: sensorHumidity !== null ? resolved.ids.humidity : resolved.humidifier,
      value: humidityValue,
      display: humidityValue === null ? "--" : `${Math.round(humidityValue)}%`,
    },
    targetReached: isUsable(reached) ? reached.state === "yes" : null,
    mist: readMist(get, resolved),
    waterEmpty,
    alerts: readAlerts({ waterEmpty, maintenance }, resolved),
    settings: {
      display: onOff(get("display")),
      panelSound: onOff(get("panelSound")),
      schedule: onOff(get("schedule")),
      ambientLight: onOff(get("ambientLight")),
      lightLow: numericState(get("lightLow")),
      lightHigh: numericState(get("lightHigh")),
    },
    maintenance,
  };
}
