import { afterEach, describe, expect, it } from "vitest";
import "../src/card";
import type { DreoHumidifierCard } from "../src/card";
import type { HassEntity } from "../src/types";
import { CARD_TAG } from "../vite.config";
import { HUMIDIFIER, fakeHass, setState, type FakeHass } from "./helpers";

async function mount(hass: FakeHass, config: Record<string, unknown> = {}) {
  const card = document.createElement(CARD_TAG) as DreoHumidifierCard;
  card.setConfig({ type: `custom:${CARD_TAG}`, entity: HUMIDIFIER, ...config });
  card.hass = hass;
  document.body.append(card);
  await card.updateComplete;
  return { card, root: card.shadowRoot! };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
const button = (root: ShadowRoot, label: string, group?: string) =>
  [...root.querySelectorAll(group ? `[aria-label="${group}"] button` : "button")].find((el) => text(el) === label) as
    | HTMLButtonElement
    | undefined;
const titles = (root: ShadowRoot) => [...root.querySelectorAll(".section-title")].map((el) => el.textContent);

const inManual = (states: Record<string, HassEntity>) => setState(states, HUMIDIFIER, "on", { mode: "normal" });

afterEach(() => document.body.replaceChildren());

describe("card", () => {
  it("registers under the configured tag", () => {
    expect(customElements.get(CARD_TAG)).toBeDefined();
  });

  it("renders the header, readings and every section", async () => {
    const { root } = await mount(fakeHass());
    expect(text(root.querySelector(".title"))).toBe("Office Humidifier");
    expect(text(root.querySelector(".status"))).toBe("Auto · Holding 55%");
    expect([...root.querySelectorAll(".reading .value")].map(text)).toEqual(["56%", "Paused", "OK"]);
    expect(root.querySelector(".reading.reached")).not.toBeNull();
    expect(titles(root)).toEqual(["Humidify", "Settings", "Maintenance"]);
    expect([...root.querySelectorAll('[aria-label="Mode"] button')].map((el) => [text(el), el.getAttribute("aria-pressed")])).toEqual([
      ["Manual", "false"],
      ["Auto", "true"],
      ["Sleep", "false"],
    ]);
  });

  it("keeps the controls in a disclosure that starts collapsed", async () => {
    const { card, root } = await mount(fakeHass());
    const disclosure = root.querySelector<HTMLButtonElement>(".disclosure")!;
    const panel = root.querySelector("#dhc-controls")!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hasAttribute("inert")).toBe(true);
    disclosure.click();
    await card.updateComplete;
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.classList.contains("open")).toBe(true);
  });

  it("shows a target slider in Auto and mist levels in Manual", async () => {
    const auto = await mount(fakeHass());
    expect(auto.root.querySelector('input[aria-label="Target humidity"]')).not.toBeNull();
    expect(auto.root.querySelector('[aria-label="Mist level"]')).toBeNull();
    auto.card.remove();

    const manual = await mount(fakeHass(inManual));
    expect(manual.root.querySelector('input[aria-label="Target humidity"]')).toBeNull();
    expect(text(manual.root.querySelector(".status"))).toBe("Manual · Mist low");
    expect(button(manual.root, "Low", "Mist level")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("changes mode and mist level optimistically", async () => {
    const hass = fakeHass(inManual);
    const { card, root } = await mount(hass);
    button(root, "High", "Mist level")!.click();
    await card.updateComplete;
    expect(hass.calls.at(-1)).toEqual({
      domain: "select",
      service: "select_option",
      data: { entity_id: "select.office_humidifier_mist_level", option: "high" },
    });
    expect(button(root, "High", "Mist level")?.getAttribute("aria-pressed")).toBe("true");

    button(root, "Sleep", "Mode")!.click();
    await card.updateComplete;
    expect(hass.calls.at(-1)).toEqual({ domain: "humidifier", service: "set_mode", data: { entity_id: HUMIDIFIER, mode: "sleep" } });
    expect(root.querySelector('input[aria-label="Sleep target humidity"]')).not.toBeNull();
  });

  it("commits a snapped target from the slider", async () => {
    const hass = fakeHass();
    const { card, root } = await mount(hass, { humidity_step: 5 });
    const slider = root.querySelector<HTMLInputElement>('input[aria-label="Target humidity"]')!;
    slider.value = "62";
    slider.dispatchEvent(new Event("change"));
    await card.updateComplete;
    expect(hass.calls).toEqual([{ domain: "humidifier", service: "set_humidity", data: { entity_id: HUMIDIFIER, humidity: 60 } }]);
    expect(text(root.querySelector(".field-value"))).toBe("60%");
  });

  it("turns the humidifier off", async () => {
    const hass = fakeHass();
    const { card, root } = await mount(hass);
    root.querySelector<HTMLButtonElement>(".icon-toggle")!.click();
    await card.updateComplete;
    expect(hass.calls).toEqual([{ domain: "humidifier", service: "turn_off", data: { entity_id: HUMIDIFIER } }]);
    expect(text(root.querySelector(".status"))).toBe("Off");
  });

  it("toggles settings and keeps the light thresholds five apart", async () => {
    const hass = fakeHass((states) => {
      setState(states, "number.office_humidifier_humlight_low", "55");
      setState(states, "number.office_humidifier_humlight_high", "60");
    });
    const { card, root } = await mount(hass);
    button(root, "Sound")!.click();
    await card.updateComplete;
    expect(hass.calls.at(-1)).toEqual({ domain: "switch", service: "turn_on", data: { entity_id: "switch.office_humidifier_panel_sound" } });
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Dry below 5% higher"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Humid above 5% lower"]')!.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('[aria-label="Humid above 5% higher"]')!.click();
    await card.updateComplete;
    expect(hass.calls.at(-1)?.data).toEqual({ entity_id: "number.office_humidifier_humlight_high", value: 65 });
  });

  it("shows a refill banner and an empty water tile", async () => {
    const { root } = await mount(
      fakeHass((states) => setState(states, "binary_sensor.office_humidifier_water_empty", "on", { water_level: "empty" })),
    );
    expect(text(root.querySelector(".alert.error"))).toMatch(/Water tank empty/);
    expect(text(root.querySelector(".reading.empty .value"))).toBe("Empty");
    expect(text(root.querySelector(".status"))).toBe("Auto · Out of water");
  });

  it("hides optional panels when configured", async () => {
    const { root } = await mount(fakeHass(), { show_settings: false, show_maintenance: false });
    expect(titles(root)).toEqual(["Humidify"]);
  });

  it("disables controls when the humidifier is unavailable", async () => {
    const { root } = await mount(fakeHass((states) => setState(states, HUMIDIFIER, "unavailable")));
    expect(text(root.querySelector(".banner"))).toMatch(/Office Humidifier can't be reached/);
    expect(root.querySelector<HTMLButtonElement>(".icon-toggle")!.disabled).toBe(true);
  });
});
