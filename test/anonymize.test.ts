import { describe, expect, it } from "vitest";
import { anonymize } from "../dev/anonymize.mjs";

describe("anonymize", () => {
  it("removes the serial, device id and addresses", () => {
    const serial = "1234567890123456789-abcdef0123456789:001:0000000000b";
    const data = {
      device: { id: "f00dfeed", name: "Office Humidifier" },
      entities: [{ entity_id: "sensor.office_humidifier_humidity", unique_id: `${serial}-Humidity` }],
      states: [{ entity_id: "sensor.router", state: "10.1.2.3" }],
    };
    const result = JSON.stringify(anonymize(data, { serial, deviceId: "f00dfeed" }));
    expect(result).not.toMatch(/1234567890123456789|f00dfeed|10\.1\.2\.3/);
    expect(result).toContain("sensor.office_humidifier_humidity");
    expect(result).toContain("Office Humidifier");
  });
});
