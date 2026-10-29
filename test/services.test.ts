import { describe, expect, it } from "vitest";
import { resolveEntities } from "../src/entities";
import { createServices, snapToStep } from "../src/services";
import { HUMIDIFIER, fakeHass } from "./helpers";

const services = createServices(resolveEntities(fakeHass(), HUMIDIFIER));

describe("service mapping", () => {
  it("drives the humidifier entity", () => {
    expect(services.power(false)).toEqual([{ domain: "humidifier", service: "turn_off", data: { entity_id: HUMIDIFIER } }]);
    expect(services.mode("sleep")).toEqual([
      { domain: "humidifier", service: "set_mode", data: { entity_id: HUMIDIFIER, mode: "sleep" } },
    ]);
  });

  it("writes the auto target through the humidifier and the sleep target through its number", () => {
    expect(services.targetHumidity(60, "auto")).toEqual([
      { domain: "humidifier", service: "set_humidity", data: { entity_id: HUMIDIFIER, humidity: 60 } },
    ]);
    expect(services.targetHumidity(45, "sleep")).toEqual([
      { domain: "number", service: "set_value", data: { entity_id: "number.office_humidifier_sleep_target_humidity", value: 45 } },
    ]);
  });

  it("sets mist, switches, the ambient light and its thresholds", () => {
    expect(services.mistLevel("high")[0].data).toEqual({ entity_id: "select.office_humidifier_mist_level", option: "high" });
    expect(services.toggle("panelSound", true)).toEqual([
      { domain: "switch", service: "turn_on", data: { entity_id: "switch.office_humidifier_panel_sound" } },
    ]);
    expect(services.ambientLight(false)).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: "light.office_humidifier_ambient_light" } },
    ]);
    expect(services.lightThreshold("lightHigh", 65)[0].data).toEqual({ entity_id: "number.office_humidifier_humlight_high", value: 65 });
  });
});

describe("snapToStep", () => {
  it("snaps from the minimum and clamps to the range", () => {
    expect([28, 32, 53, 57, 95].map((value) => snapToStep(value, 5, 30, 90))).toEqual([30, 30, 55, 55, 90]);
    expect(snapToStep(52, 1, 30, 90)).toBe(52);
  });
});
