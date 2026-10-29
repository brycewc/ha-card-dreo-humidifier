import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENTITY_KEYS, resolveEntities, trackedEntityIds, type ResolvedEntities } from "../../src/entities";
import { MODES, readModel } from "../../src/model";
import type { HomeAssistant } from "../../src/types";
import { connectLive, liveConfigured } from "./live-helpers";

// hass-dreo only verified this sensor on the DR-HHM014S and disables it by default.
const IGNORED_TRANSLATION_KEYS = new Set(["water_level_percent"]);

describe.skipIf(!liveConfigured)("live Home Assistant contract (read-only)", () => {
  let live: Awaited<ReturnType<typeof connectLive>>;
  let hass: HomeAssistant;
  let resolved: ResolvedEntities;

  beforeAll(async () => {
    live = await connectLive();
    hass = live.hass;
    resolved = resolveEntities(hass, live.device.humidifierEntity);
  });

  afterAll(() => live?.connection.close());

  it("blocks anything that is not a read", async () => {
    await expect(
      live.connection.sendMessagePromise({ type: "call_service", domain: "humidifier", service: "turn_on" }),
    ).rejects.toThrow(/Blocked non-read-only/);
  });

  it("resolves the device and every entity the card needs", () => {
    expect(resolved.deviceId).toBe(live.device.device?.id);
    expect(ENTITY_KEYS.filter((key) => !resolved.ids[key])).toEqual([]);
  });

  it("knows about every hass-dreo entity on the device", () => {
    const known = new Set(trackedEntityIds(resolved));
    const unknown = Object.values(hass.entities)
      .filter((entry) => !known.has(entry.entity_id) && !IGNORED_TRANSLATION_KEYS.has(entry.translation_key ?? ""))
      .map((entry) => `${entry.entity_id} (${entry.translation_key ?? "no translation_key"})`);
    expect(unknown).toEqual([]);
  });

  it("matches the attribute shapes the card reads", () => {
    const state = (id: string | undefined) => hass.states[id!];
    const humidifier = state(resolved.humidifier).attributes;
    expect(humidifier.available_modes).toEqual(expect.arrayContaining([...MODES]));
    expect(typeof humidifier.min_humidity).toBe("number");
    expect(typeof humidifier.max_humidity).toBe("number");
    expect(MODES).toContain(humidifier.mode);

    expect(state(resolved.ids.mistLevel).attributes.options).toEqual(["low", "medium", "high"]);
    expect(state(resolved.ids.sleepTarget).attributes).toMatchObject({ min: humidifier.min_humidity, max: humidifier.max_humidity });
    expect(state(resolved.ids.targetReached).attributes.options).toEqual(["yes", "no"]);
    expect(state(resolved.ids.filterActive).attributes.options).toEqual(["active", "inactive"]);
    expect(["on", "off"]).toContain(state(resolved.ids.waterEmpty).state);
  });

  it("offers the services with the names the card calls", async () => {
    const services = await live.connection.sendMessagePromise<Record<string, Record<string, unknown>>>({ type: "get_services" });
    expect(Object.keys(services.humidifier)).toEqual(expect.arrayContaining(["set_mode", "set_humidity", "turn_on", "turn_off"]));
    expect(Object.keys(services.number)).toContain("set_value");
    expect(Object.keys(services.select)).toContain("select_option");
  });

  it("builds a complete model from live data", () => {
    const model = readModel(hass, resolved);
    expect(model.available).toBe(true);
    expect(model.mode).not.toBeNull();
    expect(model.humidity.value).not.toBeNull();
    expect(model.mist?.kind).toBe("select");
    expect(model.targets.sleep).not.toBeNull();
  });
});
