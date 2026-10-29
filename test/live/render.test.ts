// @vitest-environment happy-dom
import { describe, expect, inject, it } from "vitest";
import "../../src/card";
import type { DreoHumidifierCard } from "../../src/card";
import type { HomeAssistant } from "../../src/types";
import { CARD_TAG } from "../../vite.config";

const live = inject("liveDevice");

describe.skipIf(!live)("live render smoke test", () => {
  it("renders every section against live states without errors", async () => {
    const hass: HomeAssistant = {
      states: Object.fromEntries(live!.states.map((state) => [state.entity_id, state])),
      entities: Object.fromEntries(live!.entities.map((entry) => [entry.entity_id, entry])),
      callService: () => Promise.reject(new Error("Live tests are read-only.")),
      callWS: async () => ({ value: null }) as never,
    };
    const card = document.createElement(CARD_TAG) as DreoHumidifierCard;
    card.setConfig({ type: `custom:${CARD_TAG}`, entity: live!.humidifierEntity });
    card.hass = hass;
    document.body.append(card);
    await card.updateComplete;
    const root = card.shadowRoot!;
    expect(root.querySelector(".banner")).toBeNull();
    expect([...root.querySelectorAll(".section-title")].map((el) => el.textContent)).toEqual(["Humidify", "Settings", "Maintenance"]);
    expect(root.querySelectorAll(".reading .value")).toHaveLength(3);
    card.remove();
  });
});
