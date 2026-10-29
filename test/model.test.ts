import { describe, expect, it } from "vitest";
import { resolveEntities } from "../src/entities";
import { readModel } from "../src/model";
import { HUMIDIFIER, fakeHass, setState } from "./helpers";

const model = (patch?: Parameters<typeof fakeHass>[0]) => {
  const hass = fakeHass(patch);
  return readModel(hass, resolveEntities(hass, HUMIDIFIER));
};

describe("readModel", () => {
  it("reads the snapshot", () => {
    const m = model();
    expect(m.available).toBe(true);
    expect(m.power).toBe(true);
    expect(m.mode).toBe("auto");
    expect(m.modes).toEqual(["normal", "auto", "sleep"]);
    expect(m.targets).toEqual({ auto: 55, sleep: 55 });
    expect([m.min, m.max]).toEqual([30, 90]);
    expect(m.mist).toMatchObject({ kind: "select", value: "low", options: ["low", "medium", "high"] });
    expect(m.waterEmpty).toBe(false);
    expect(m.maintenance).toEqual({ filterLife: 85, filterActive: true, useSinceCleaning: 28 });
    expect(m.settings).toMatchObject({ display: true, panelSound: false, schedule: false, ambientLight: true, lightLow: 30, lightHigh: 60 });
    expect(m.alerts).toEqual([]);
  });

  it("does not mistake the sleep target for the auto target in sleep mode", () => {
    const m = model((states) => {
      setState(states, HUMIDIFIER, "on", { mode: "sleep", humidity: 45 });
      setState(states, "number.office_humidifier_sleep_target_humidity", "45");
    });
    expect(m.targets).toEqual({ auto: null, sleep: 45 });
  });

  it("falls back to the fog level number without a mist select", () => {
    const hass = fakeHass();
    delete hass.entities["select.office_humidifier_mist_level"];
    const m = readModel(hass, resolveEntities(hass, HUMIDIFIER));
    expect(m.mist).toMatchObject({ kind: "number", value: 2, min: 1, max: 6 });
  });

  it("raises water and filter alerts", () => {
    const m = model((states) => {
      setState(states, "binary_sensor.office_humidifier_water_empty", "on", { water_level: "empty" });
      setState(states, "sensor.office_humidifier_filter_life", "6");
    });
    expect(m.alerts.map((alert) => [alert.id, alert.tone])).toEqual([
      ["water-empty", "error"],
      ["filter-low", "warning"],
    ]);
    expect(m.alerts[1].message).toMatch(/6% left/);
  });

  it("names the device and marks it unavailable", () => {
    const m = model((states) => setState(states, HUMIDIFIER, "unavailable"));
    expect(m.available).toBe(false);
    expect(m.deviceName).toBe("Office Humidifier");
  });
});
