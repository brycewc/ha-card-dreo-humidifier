import { describe, expect, it } from "vitest";
import { ENTITY_KEYS, resolveEntities } from "../src/entities";
import { DEVICE_ID, HUMIDIFIER, fakeHass } from "./helpers";

describe("resolveEntities", () => {
  const hass = fakeHass();
  const resolved = resolveEntities(hass, HUMIDIFIER);

  it("finds the device from the humidifier entity", () => {
    expect(resolved.deviceId).toBe(DEVICE_ID);
  });

  it("resolves every key on the 524S", () => {
    expect(ENTITY_KEYS.filter((key) => !resolved.ids[key])).toEqual([]);
  });

  it("matches by translation key", () => {
    expect(resolved.ids).toMatchObject({
      humidity: "sensor.office_humidifier_humidity",
      waterEmpty: "binary_sensor.office_humidifier_water_empty",
      mistLevel: "select.office_humidifier_mist_level",
      sleepTarget: "number.office_humidifier_sleep_target_humidity",
      useSinceCleaning: "sensor.office_humidifier_use_since_cleaning",
      schedule: "switch.office_humidifier_schedule",
      lightLow: "number.office_humidifier_humlight_low",
    });
  });

  it("falls back to entity_id suffixes without translation keys", () => {
    const bare = fakeHass();
    for (const entry of Object.values(bare.entities)) entry.translation_key = undefined;
    const fallback = resolveEntities(bare, HUMIDIFIER);
    expect(ENTITY_KEYS.filter((key) => fallback.ids[key] !== resolved.ids[key])).toEqual([]);
  });

  it("applies config overrides", () => {
    const overridden = resolveEntities(hass, HUMIDIFIER, { humidity: "sensor.elsewhere" });
    expect(overridden.ids.humidity).toBe("sensor.elsewhere");
  });
});
