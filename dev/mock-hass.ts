import registry from "../test/fixtures/entities.json";
import fixtureStates from "../test/fixtures/states.json";
import { resolveEntities } from "../src/entities";
import type { EntityRegistryEntry, HassEntity, HomeAssistant } from "../src/types";

export type HassListener = (hass: HomeAssistant) => void;
export type LogFn = (kind: string, message: string) => void;

// The real device round-trips through the Dreo cloud, so changes land after a short delay.
const DEVICE_LATENCY = 600;
const MIST_FOG_LEVELS: Record<string, number> = { low: 2, medium: 4, high: 6 };

export class MockHass {
  readonly humidifierEntity = registry.humidifierEntity;
  private states: Record<string, HassEntity>;
  private readonly entities: Record<string, EntityRegistryEntry>;
  private readonly ids;
  private autoTarget: number;

  constructor(
    private readonly onChange: HassListener,
    private readonly log: LogFn,
  ) {
    this.states = Object.fromEntries(
      (structuredClone(fixtureStates) as HassEntity[]).map((state) => [state.entity_id, state]),
    );
    this.entities = Object.fromEntries(
      (registry.entities as EntityRegistryEntry[]).map((entry) => [entry.entity_id, entry]),
    );
    this.ids = resolveEntities(this.hass(), this.humidifierEntity).ids;
    this.autoTarget = Number(this.states[this.humidifierEntity].attributes.humidity ?? 50);
  }

  hass(): HomeAssistant {
    return {
      states: this.states,
      entities: this.entities,
      devices: { [registry.device.id]: { ...registry.device } },
      user: { id: "mock-user", name: "Mock", is_admin: true },
      callService: (domain, service, data = {}) => this.callService(domain, service, data),
      callWS: (message) => this.callWS(message),
    };
  }

  private emit() {
    this.onChange(this.hass());
  }

  private patch(entityId: string | undefined, state?: string, attributes: Record<string, unknown> = {}) {
    if (!entityId) return;
    const current = this.states[entityId];
    const now = new Date().toISOString();
    const nextState = state ?? current.state;
    this.states = {
      ...this.states,
      [entityId]: {
        ...current,
        state: nextState,
        attributes: { ...current.attributes, ...attributes },
        last_updated: now,
        last_changed: nextState === current.state ? current.last_changed : now,
      },
    };
  }

  setWaterEmpty(empty: boolean) {
    this.patch(this.ids.waterEmpty, empty ? "on" : "off", { water_level: empty ? "empty" : "ok" });
    this.emit();
  }

  setTargetReached(reached: boolean) {
    this.patch(this.ids.targetReached, reached ? "yes" : "no");
    this.emit();
  }

  setFilterLow(low: boolean) {
    this.patch(this.ids.filterLife, low ? "7" : "85");
    this.emit();
  }

  setAvailable(available: boolean) {
    this.patch(this.humidifierEntity, available ? "on" : "unavailable");
    this.emit();
  }

  private async callService(domain: string, service: string, data: Record<string, unknown>) {
    this.log("service", `${domain}.${service} ${JSON.stringify(data)}`);
    setTimeout(() => {
      this.apply(domain, service, data);
      this.emit();
    }, DEVICE_LATENCY);
  }

  private setSleepTarget(value: number) {
    this.patch(this.ids.sleepTarget, String(value));
    if (this.states[this.humidifierEntity].attributes.mode === "sleep") {
      this.patch(this.humidifierEntity, undefined, { humidity: value });
    }
  }

  private apply(domain: string, service: string, data: Record<string, any>) {
    const humidifier = this.humidifierEntity;
    switch (`${domain}.${service}`) {
      case "humidifier.turn_on":
        return this.patch(humidifier, "on");
      case "humidifier.turn_off":
        return this.patch(humidifier, "off");
      case "humidifier.set_mode": {
        const sleep = data.mode === "sleep";
        const target = sleep ? Number(this.states[this.ids.sleepTarget!]?.state ?? 50) : this.autoTarget;
        return this.patch(humidifier, "on", { mode: data.mode, humidity: target });
      }
      case "humidifier.set_humidity":
        if (this.states[humidifier].attributes.mode === "sleep") return this.setSleepTarget(data.humidity);
        this.autoTarget = data.humidity;
        return this.patch(humidifier, undefined, { humidity: data.humidity });
      case "number.set_value":
        if (data.entity_id === this.ids.sleepTarget) return this.setSleepTarget(data.value);
        return this.patch(data.entity_id, String(data.value));
      case "select.select_option":
        if (data.entity_id === this.ids.mistLevel) this.patch(this.ids.fogLevel, String(MIST_FOG_LEVELS[data.option]));
        return this.patch(data.entity_id, data.option);
      case "switch.turn_on":
      case "switch.turn_off":
      case "light.turn_on":
      case "light.turn_off":
        return this.patch(data.entity_id, service === "turn_on" ? "on" : "off");
      default:
        this.log("warn", `Mock does not simulate ${domain}.${service}`);
    }
  }

  private async callWS<T>(message: Record<string, unknown>): Promise<T> {
    this.log("ws", JSON.stringify(message));
    throw new Error(`Mock does not handle ${message.type}`);
  }
}
