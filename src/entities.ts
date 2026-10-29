import type { EntityRegistryEntry, HomeAssistant } from "./types";

interface EntitySpec {
  domain: string;
  translationKeys: string[];
  suffixes: string[];
}

export const ENTITY_SPECS = {
  humidity: { domain: "sensor", translationKeys: ["humidity"], suffixes: ["_humidity"] },
  targetReached: {
    domain: "sensor",
    translationKeys: ["target_humidity_reached"],
    suffixes: ["_target_humidity_reached"],
  },
  waterEmpty: { domain: "binary_sensor", translationKeys: ["water_empty"], suffixes: ["_water_empty"] },
  mistLevel: { domain: "select", translationKeys: ["mist_level"], suffixes: ["_mist_level"] },
  fogLevel: { domain: "number", translationKeys: ["fog_level"], suffixes: ["_fog_level"] },
  sleepTarget: {
    domain: "number",
    translationKeys: ["sleep_target_humidity"],
    suffixes: ["_sleep_target_humidity"],
  },
  filterLife: { domain: "sensor", translationKeys: ["filter_life"], suffixes: ["_filter_life"] },
  filterActive: { domain: "sensor", translationKeys: ["filter_active"], suffixes: ["_filter_active"] },
  useSinceCleaning: { domain: "sensor", translationKeys: ["use_hours_hm"], suffixes: ["_use_since_cleaning"] },
  display: { domain: "switch", translationKeys: ["display_light"], suffixes: ["_display"] },
  panelSound: { domain: "switch", translationKeys: ["panel_sound"], suffixes: ["_panel_sound"] },
  schedule: { domain: "switch", translationKeys: ["scheon"], suffixes: ["_schedule"] },
  ambientLight: { domain: "light", translationKeys: ["ambient_light"], suffixes: ["_ambient_light"] },
  lightLow: { domain: "number", translationKeys: ["ambient_light_threshold_low"], suffixes: ["_humlight_low"] },
  lightHigh: { domain: "number", translationKeys: ["ambient_light_threshold_high"], suffixes: ["_humlight_high"] },
} satisfies Record<string, EntitySpec>;

export type EntityKey = keyof typeof ENTITY_SPECS;

export const ENTITY_KEYS = Object.keys(ENTITY_SPECS) as EntityKey[];

export interface ResolvedEntities {
  humidifier: string;
  deviceId: string | null;
  ids: Partial<Record<EntityKey, string>>;
}

function domainOf(entityId: string): string {
  return entityId.slice(0, entityId.indexOf("."));
}

function findEntity(entries: EntityRegistryEntry[], spec: EntitySpec): string | undefined {
  const inDomain = entries.filter((entry) => domainOf(entry.entity_id) === spec.domain);
  for (const key of spec.translationKeys) {
    const match = inDomain.find((entry) => entry.translation_key === key);
    if (match) return match.entity_id;
  }
  for (const suffix of spec.suffixes) {
    const match = inDomain.find((entry) => entry.entity_id.endsWith(suffix));
    if (match) return match.entity_id;
  }
  return undefined;
}

export function deviceEntries(hass: HomeAssistant, deviceId: string | null): EntityRegistryEntry[] {
  if (!deviceId) return [];
  return Object.values(hass.entities ?? {}).filter((entry) => entry.device_id === deviceId);
}

export function resolveEntities(
  hass: HomeAssistant,
  humidifierEntityId: string,
  overrides: Partial<Record<string, string>> = {},
  cachedEntries?: EntityRegistryEntry[],
): ResolvedEntities {
  const deviceId = hass.entities?.[humidifierEntityId]?.device_id ?? null;
  const entries = cachedEntries ?? deviceEntries(hass, deviceId);

  const ids: Partial<Record<EntityKey, string>> = {};
  for (const key of ENTITY_KEYS) {
    const id = overrides[key] || findEntity(entries, ENTITY_SPECS[key]);
    if (id) ids[key] = id;
  }
  return { humidifier: humidifierEntityId, deviceId, ids };
}

export function trackedEntityIds(resolved: ResolvedEntities): string[] {
  return [resolved.humidifier, ...Object.values(resolved.ids)].filter((id): id is string => Boolean(id));
}
