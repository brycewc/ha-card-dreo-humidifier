import type { EntityKey, ResolvedEntities } from "./entities";
import type { HumidifierMode } from "./model";
import type { ServiceCall } from "./types";

const call = (domain: string, service: string, data: Record<string, unknown>): ServiceCall => ({
  domain,
  service,
  data,
});

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snapToStep(value: number, step: number, min: number, max: number): number {
  return clamp(min + Math.round((value - min) / step) * step, min, max);
}

export type SwitchKey = Extract<EntityKey, "display" | "panelSound" | "schedule">;

export function createServices(entities: ResolvedEntities) {
  const humidifier = entities.humidifier;
  const { ids } = entities;

  return {
    power: (on: boolean) => [call("humidifier", on ? "turn_on" : "turn_off", { entity_id: humidifier })],

    mode: (mode: HumidifierMode) => [call("humidifier", "set_mode", { entity_id: humidifier, mode })],

    // The humidifier entity only writes the sleep target while the device is already in sleep mode,
    // so the dedicated number is safer right after a mode change.
    targetHumidity: (value: number, mode: HumidifierMode | null): ServiceCall[] => {
      const humidity = Math.round(value);
      if (mode === "sleep" && ids.sleepTarget) {
        return [call("number", "set_value", { entity_id: ids.sleepTarget, value: humidity })];
      }
      return [call("humidifier", "set_humidity", { entity_id: humidifier, humidity })];
    },

    mistLevel: (option: string) =>
      ids.mistLevel ? [call("select", "select_option", { entity_id: ids.mistLevel, option })] : [],

    fogLevel: (level: number) =>
      ids.fogLevel ? [call("number", "set_value", { entity_id: ids.fogLevel, value: Math.round(level) })] : [],

    toggle: (key: SwitchKey, on: boolean) => {
      const id = ids[key];
      return id ? [call("switch", on ? "turn_on" : "turn_off", { entity_id: id })] : [];
    },

    ambientLight: (on: boolean) =>
      ids.ambientLight ? [call("light", on ? "turn_on" : "turn_off", { entity_id: ids.ambientLight })] : [],

    lightThreshold: (which: "lightLow" | "lightHigh", value: number) => {
      const id = ids[which];
      return id ? [call("number", "set_value", { entity_id: id, value: Math.round(value) })] : [];
    },
  };
}

export type DreoServices = ReturnType<typeof createServices>;
