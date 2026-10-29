import { LitElement, html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import { deviceEntries, resolveEntities, trackedEntityIds, type ResolvedEntities } from "./entities";
import { capitalize, formatHours } from "./format";
import { LOW_FILTER_PERCENT, MODE_LABELS, readModel, type DreoModel, type HumidifierMode } from "./model";
import { PendingStore } from "./pending";
import { clamp, createServices, snapToStep, type DreoServices, type SwitchKey } from "./services";
import { cardStyles, tokens } from "./styles";
import type { CardConfig, EntityRegistryEntry, HassEntity, HomeAssistant, ServiceCall } from "./types";

declare const __CARD_TAG__: string;

const PENDING_TTL = 15_000;
const DEFAULT_HUMIDITY_STEP = 5;
const THRESHOLD_STEP = 5;
const THRESHOLD_GAP = 5;

const MODE_ICONS: Record<HumidifierMode, string> = {
  normal: "mdi:hand-back-right-outline",
  auto: "mdi:water-sync",
  sleep: "mdi:weather-night",
};

type TargetedMode = Exclude<HumidifierMode, "normal">;

export class DreoHumidifierCard extends LitElement {
  static override styles = [tokens, cardStyles];

  static override properties = {
    _config: { state: true },
    _maintenanceOpen: { state: true },
    _controlsOpen: { state: true },
    _sliderDrafts: { state: true },
  };

  declare private _config: CardConfig | undefined;
  declare private _maintenanceOpen: boolean;
  declare private _controlsOpen: boolean;
  declare private _sliderDrafts: Record<string, number>;

  private _hass?: HomeAssistant;
  private _resolved?: ResolvedEntities;
  private _resolvedFor?: { entities: unknown; config: CardConfig; deviceEntries: EntityRegistryEntry[] };
  private _lastStates = new Map<string, HassEntity | undefined>();
  private _services?: DreoServices;
  private _lastAutoTarget: number | null = null;
  private readonly _pending = new PendingStore(() => this.requestUpdate());

  constructor() {
    super();
    this._maintenanceOpen = false;
    this._controlsOpen = false;
    this._sliderDrafts = {};
  }

  static getStubConfig(hass?: HomeAssistant): Partial<CardConfig> {
    const humidifier = Object.values(hass?.entities ?? {}).find(
      (entry) => entry.platform === "dreo" && entry.entity_id.startsWith("humidifier."),
    );
    return { entity: humidifier?.entity_id ?? "" };
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: "entity",
          required: true,
          selector: { entity: { filter: [{ domain: "humidifier", integration: "dreo" }] } },
        },
        { name: "title", selector: { text: {} } },
        { name: "humidity_step", selector: { number: { min: 1, max: 10, step: 1, mode: "box" } } },
        { name: "show_settings", selector: { boolean: {} } },
        { name: "show_maintenance", selector: { boolean: {} } },
      ],
      computeLabel: (schema: { name: string }) =>
        ({
          entity: "Dreo humidifier",
          title: "Title",
          humidity_step: "Target humidity step (%)",
          show_settings: "Settings panel",
          show_maintenance: "Maintenance panel",
        })[schema.name],
    };
  }

  setConfig(config: CardConfig): void {
    if (!config?.entity) throw new Error("Set entity to the Dreo humidifier entity (humidifier.*).");
    if (!config.entity.startsWith("humidifier.")) throw new Error("entity must be a humidifier.* entity from hass-dreo.");
    this._config = { show_settings: true, show_maintenance: true, humidity_step: DEFAULT_HUMIDITY_STEP, ...config };
    this._resolvedFor = undefined;
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    const resolvedChanged = this._resolve(hass);
    if (first || resolvedChanged || this._trackedStatesChanged(hass)) {
      this._reconcilePending();
      this.requestUpdate();
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  getCardSize(): number {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._pending.dispose();
  }

  private _resolve(hass: HomeAssistant): boolean {
    const config = this._config!;
    const cached = this._resolvedFor;
    let entries = cached?.deviceEntries;
    if (!cached || cached.entities !== hass.entities || cached.config !== config) {
      const deviceId = hass.entities?.[config.entity]?.device_id ?? null;
      entries = deviceEntries(hass, deviceId);
    }
    const next = resolveEntities(hass, config.entity, config.entities ?? {}, entries);
    const changed = JSON.stringify(next) !== JSON.stringify(this._resolved);
    this._resolvedFor = { entities: hass.entities, config, deviceEntries: entries ?? [] };
    if (changed) {
      this._resolved = next;
      this._services = createServices(next);
      this._lastStates.clear();
    }
    return changed;
  }

  private _trackedStatesChanged(hass: HomeAssistant): boolean {
    if (!this._resolved) return false;
    let changed = false;
    for (const id of trackedEntityIds(this._resolved)) {
      const state = hass.states[id];
      if (this._lastStates.get(id) !== state) {
        this._lastStates.set(id, state);
        changed = true;
      }
    }
    return changed;
  }

  private _model(): DreoModel {
    const model = readModel(this._hass!, this._resolved!);
    // The device only reports the auto target outside sleep mode, so remember it for switching back.
    if (model.targets.auto !== null) this._lastAutoTarget = model.targets.auto;
    return { ...model, targets: { ...model.targets, auto: model.targets.auto ?? this._lastAutoTarget } };
  }

  private _reconcilePending(): void {
    if (!this._hass || !this._resolved || !this._pending.size) return;
    const model = this._model();
    const s = model.settings;
    this._pending.reconcile(
      {
        power: model.power,
        mode: model.mode,
        "target-auto": model.targets.auto,
        "target-sleep": model.targets.sleep,
        mist: model.mist?.value ?? null,
        display: s.display,
        panelSound: s.panelSound,
        schedule: s.schedule,
        ambientLight: s.ambientLight,
        lightLow: s.lightLow,
        lightHigh: s.lightHigh,
      },
      (_key, pending, actual) => pending === actual,
    );
  }

  private _notify(message: string): void {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  private _moreInfo(entityId: string | undefined): void {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  private async _run(calls: ServiceCall[], pending?: { key: string; value: unknown }): Promise<void> {
    if (!this._hass || !calls.length) return;
    if (pending) this._pending.set(pending.key, pending.value, PENDING_TTL);
    this.requestUpdate();
    try {
      for (const { domain, service, data } of calls) {
        await this._hass.callService(domain, service, data);
      }
    } catch (error) {
      if (pending) this._pending.clear(pending.key);
      this._notify(`Dreo: ${(error as Error).message ?? error}`);
    }
    this.requestUpdate();
  }

  private _view(): DreoModel | null {
    if (!this._hass || !this._resolved) return null;
    const model = this._model();
    const p = this._pending;
    const s = model.settings;
    return {
      ...model,
      power: p.value("power", model.power),
      mode: p.value("mode", model.mode),
      targets: {
        auto: this._sliderDrafts["target-auto"] ?? p.value("target-auto", model.targets.auto),
        sleep: this._sliderDrafts["target-sleep"] ?? p.value("target-sleep", model.targets.sleep),
      },
      mist: model.mist
        ? ({
            ...model.mist,
            value: model.mist.kind === "number" ? (this._sliderDrafts.mist ?? p.value("mist", model.mist.value)) : p.value("mist", model.mist.value),
          } as DreoModel["mist"])
        : null,
      settings: {
        display: p.value("display", s.display),
        panelSound: p.value("panelSound", s.panelSound),
        schedule: p.value("schedule", s.schedule),
        ambientLight: p.value("ambientLight", s.ambientLight),
        lightLow: p.value("lightLow", s.lightLow),
        lightHigh: p.value("lightHigh", s.lightHigh),
      },
    };
  }

  private _target(view: DreoModel): number | null {
    if (view.mode === "auto") return view.targets.auto;
    if (view.mode === "sleep") return view.targets.sleep;
    return null;
  }

  private _mistLabel(view: DreoModel): string {
    const mist = view.mist;
    if (!mist || mist.value === null) return "--";
    return mist.kind === "select" ? capitalize(mist.value) : `Level ${mist.value}`;
  }

  // The device pauses misting in Auto and Sleep once the room reaches the target.
  private _misting(view: DreoModel): "off" | "paused" | "on" {
    if (!view.power) return "off";
    if (view.mode !== "normal" && view.targetReached) return "paused";
    return "on";
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config) return nothing;
    if (!this._hass) return html`<ha-card><div class="card"></div></ha-card>`;
    if (!this._hass.states[this._config.entity]) {
      return html`<ha-card><div class="card"><div class="banner">Entity not found: ${this._config.entity}</div></div></ha-card>`;
    }
    const view = this._view()!;
    const unavailable = !view.available;

    return html`
      <ha-card>
        <div class=${classMap({ card: true, unavailable })}>
          ${this._renderHeader(view)}
          ${unavailable
            ? html`<div class="banner" role="status">
                <ha-icon icon="mdi:cloud-off-outline"></ha-icon>
                <span>${view.deviceName} can't be reached. Check that it is plugged in and online in the Dreo app.</span>
              </div>`
            : nothing}
          ${this._renderAlerts(view)} ${this._renderReadings(view)}
          <div class="controls">
            <button
              class=${classMap({ disclosure: true, expander: true, interactive: true, open: this._controlsOpen })}
              aria-expanded=${this._controlsOpen ? "true" : "false"}
              aria-controls="dhc-controls"
              @click=${() => (this._controlsOpen = !this._controlsOpen)}
            >
              <ha-icon icon="mdi:tune-variant"></ha-icon>
              <span>Controls</span>
              <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
            </button>
            <div id="dhc-controls" class=${classMap({ collapsible: true, open: this._controlsOpen })} ?inert=${!this._controlsOpen}>
              <div class="collapsible-inner">
                <div class="sections">
                  ${this._renderHumidify(view)} ${this._config.show_settings ? this._renderSettings(view) : nothing}
                  ${this._config.show_maintenance ? this._renderMaintenance(view) : nothing}
                </div>
              </div>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _statusLine(view: DreoModel): string {
    if (!view.available) return "Unavailable";
    if (!view.power) return "Off";
    const parts: string[] = [view.mode ? MODE_LABELS[view.mode] : "On"];
    const target = this._target(view);
    if (view.waterEmpty) parts.push("Out of water");
    else if (view.mode === "normal") parts.push(`Mist ${this._mistLabel(view).toLowerCase()}`);
    else if (target !== null) parts.push(view.targetReached ? `Holding ${target}%` : `Humidifying to ${target}%`);
    if (view.settings.schedule) parts.push("Schedule on");
    return parts.join(" · ");
  }

  private _renderHeader(view: DreoModel) {
    const title = this._config?.title?.trim() || view.name;
    return html`
      <div class="header">
        <div class="heading">
          <div class="title">${title}</div>
          <div class="status">${this._statusLine(view)}</div>
        </div>
        <button
          class=${classMap({ "icon-toggle": true, interactive: true, selected: view.power, pending: this._pending.has("power") })}
          aria-pressed=${view.power ? "true" : "false"}
          aria-label=${view.power ? "Turn off" : "Turn on"}
          ?disabled=${!view.available}
          @click=${() => this._run(this._services!.power(!view.power), { key: "power", value: !view.power })}
        >
          <ha-icon icon="mdi:power"></ha-icon>
        </button>
      </div>
    `;
  }

  private _renderAlerts(view: DreoModel) {
    if (!view.alerts.length) return nothing;
    return html`
      <div class="alerts" role="status">
        ${view.alerts.map(
          (alert) => html`
            <button class="alert interactive ${alert.tone}" @click=${() => this._moreInfo(alert.entityId)}>
              <ha-icon icon=${alert.icon}></ha-icon>
              <span>${alert.message}</span>
              <ha-icon icon="mdi:chevron-right"></ha-icon>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderReadings(view: DreoModel) {
    const target = view.power ? this._target(view) : null;
    const reached = target !== null && Boolean(view.targetReached);
    const humidityLabel = target === null ? "Room humidity" : reached ? `Reached ${target}%` : `Target ${target}%`;
    const misting = this._misting(view);
    const mistValue = misting === "off" ? "Off" : misting === "paused" ? "Paused" : this._mistLabel(view);
    const mistLabel = view.mode === "normal" || !view.power ? "Mist level" : `Mist, set by ${MODE_LABELS[view.mode!] ?? "device"}`;
    const water = view.waterEmpty === null ? "--" : view.waterEmpty ? "Empty" : "OK";
    const ids = this._resolved!.ids;

    return html`
      <div class="readings">
        <button
          class=${classMap({ reading: true, interactive: true, reached })}
          aria-label=${`Humidity ${view.humidity.display}, ${humidityLabel}`}
          @click=${() => this._moreInfo(view.humidity.entityId)}
        >
          <span class="top"><ha-icon icon="mdi:water-percent"></ha-icon></span>
          <span class="value">${view.humidity.display}</span>
          <span class="label">${humidityLabel}</span>
        </button>
        ${view.mist
          ? html`<button class="reading interactive" @click=${() => this._moreInfo(view.mist!.entityId)}>
              <span class="top"><ha-icon icon=${misting === "paused" ? "mdi:pause-circle-outline" : "mdi:weather-fog"}></ha-icon></span>
              <span class="value">${mistValue}</span>
              <span class="label">${mistLabel}</span>
            </button>`
          : nothing}
        ${ids.waterEmpty
          ? html`<button
              class=${classMap({ reading: true, interactive: true, empty: Boolean(view.waterEmpty) })}
              @click=${() => this._moreInfo(ids.waterEmpty)}
            >
              <span class="top"><ha-icon icon=${view.waterEmpty ? "mdi:water-off" : "mdi:water-check"}></ha-icon></span>
              <span class="value">${water}</span>
              <span class="label">Water tank</span>
            </button>`
          : nothing}
      </div>
    `;
  }

  private _renderSlider(options: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    valueText: (value: number) => string;
    disabled: boolean;
    showStops: boolean;
    onCommit: (value: number) => void;
  }) {
    const { key, label, min, max, step, value, disabled } = options;
    const stops = options.showStops ? Math.round((max - min) / step) : 0;
    const fraction = clamp((value - min) / (max - min), 0, 1);
    const setDraft = (next: number | undefined) => {
      const drafts = { ...this._sliderDrafts };
      if (next === undefined) delete drafts[key];
      else drafts[key] = next;
      this._sliderDrafts = drafts;
    };
    return html`
      <div class="slider" style=${styleMap({ "--fraction": String(fraction) })}>
        <div class="slider-track">
          <div class="slider-active"></div>
          <div class="slider-handle"></div>
          <div class="slider-inactive"></div>
          ${stops
            ? Array.from({ length: stops + 1 }, (_, index) => index)
                .filter((index) => index / stops !== fraction)
                .map(
                  (index) =>
                    html`<span
                      class=${classMap({ "slider-stop": true, "on-active": index / stops < fraction })}
                      style=${styleMap({ "--pos": String(index / stops) })}
                    ></span>`,
                )
            : nothing}
        </div>
        <input
          type="range"
          min=${min}
          max=${max}
          step=${step}
          .value=${String(value)}
          aria-label=${label}
          aria-valuetext=${options.valueText(value)}
          ?disabled=${disabled}
          @input=${(event: Event) => setDraft(Number((event.target as HTMLInputElement).value))}
          @change=${(event: Event) => {
            const next = Number((event.target as HTMLInputElement).value);
            setDraft(undefined);
            options.onCommit(next);
          }}
        />
      </div>
    `;
  }

  private _toggle(label: string, icon: string, selected: boolean, disabled: boolean, pendingKey: string, onClick: () => void) {
    return html`
      <button
        class=${classMap({ toggle: true, interactive: true, selected, pending: this._pending.has(pendingKey) })}
        aria-pressed=${selected ? "true" : "false"}
        ?disabled=${disabled}
        @click=${onClick}
      >
        <ha-icon icon=${icon}></ha-icon>${label}
      </button>
    `;
  }

  private _segment(label: string, icon: string | null, selected: boolean, disabled: boolean, pending: boolean, onClick: () => void) {
    return html`
      <button
        class=${classMap({ interactive: true, selected, pending })}
        aria-pressed=${selected ? "true" : "false"}
        ?disabled=${disabled}
        @click=${onClick}
      >
        ${icon ? html`<ha-icon icon=${icon}></ha-icon>` : nothing}${label}
      </button>
    `;
  }

  private _renderHumidify(view: DreoModel) {
    const disabled = !view.available;
    const mode = view.mode;
    const pendingMode = this._pending.has("mode");
    const value = !view.power ? "Off" : mode ? MODE_LABELS[mode] : "";

    return html`
      <section class=${classMap({ section: true, muted: !view.power })}>
        <div class="section-head">
          <ha-icon icon="mdi:air-humidifier"></ha-icon>
          <span class="section-title">Humidify</span>
          <span class="section-value">${value}</span>
        </div>
        <div class="connected" role="group" aria-label="Mode">
          ${view.modes.map((option) =>
            this._segment(MODE_LABELS[option], MODE_ICONS[option], mode === option, disabled, pendingMode && mode === option, () =>
              this._run(this._services!.mode(option), { key: "mode", value: option }),
            ),
          )}
        </div>
        ${mode === "normal" ? this._renderMist(view) : mode ? this._renderTarget(view, mode) : nothing}
        ${!view.power && view.available
          ? html`<div class="helper">Pick a mode or tap power to start humidifying.</div>`
          : nothing}
      </section>
    `;
  }

  private _renderTarget(view: DreoModel, mode: TargetedMode) {
    const step = Math.max(1, Number(this._config?.humidity_step) || DEFAULT_HUMIDITY_STEP);
    const key = `target-${mode}`;
    const target = view.targets[mode];
    const room = view.humidity.value;
    const scale = Array.from({ length: 5 }, (_, i) => snapToStep(view.min + ((view.max - view.min) * i) / 4, step, view.min, view.max));
    const mistNote =
      this._misting(view) === "paused"
        ? "Target reached, so misting is paused until the room dries out."
        : view.power && view.mist?.value
          ? `${MODE_LABELS[mode]} picks the mist level (now ${this._mistLabel(view).toLowerCase()}).`
          : "";

    return html`
      <div class="field">
        <div class="field-line">
          <span>${mode === "sleep" ? "Sleep target" : "Target humidity"}</span>
          <span class="field-value">${target === null ? "--" : `${target}%`}</span>
        </div>
        ${this._renderSlider({
          key,
          label: mode === "sleep" ? "Sleep target humidity" : "Target humidity",
          min: view.min,
          max: view.max,
          step,
          value: target ?? view.min,
          valueText: (value) => `${value}%`,
          disabled: !view.available,
          showStops: (view.max - view.min) / step <= 16,
          onCommit: (next) => {
            const humidity = snapToStep(next, step, view.min, view.max);
            void this._run(this._services!.targetHumidity(humidity, mode), { key, value: humidity });
          },
        })}
        <div class="slider-scale" aria-hidden="true">${scale.map((value) => html`<span>${value}%</span>`)}</div>
      </div>
      <div class="helper">
        ${[room !== null ? `Room is at ${Math.round(room)}%.` : "", mistNote].filter(Boolean).join(" ")}
      </div>
    `;
  }

  private _renderMist(view: DreoModel) {
    const mist = view.mist;
    if (!mist) return nothing;
    const disabled = !view.available;
    const pending = this._pending.has("mist");

    if (mist.kind === "select") {
      return html`
        <div class="field">
          <div class="field-line"><span>Mist level</span></div>
          <div class="connected" role="group" aria-label="Mist level">
            ${mist.options.map((option) =>
              this._segment(capitalize(option), null, mist.value === option, disabled, pending && mist.value === option, () =>
                this._run(this._services!.mistLevel(option), { key: "mist", value: option }),
              ),
            )}
          </div>
        </div>
        <div class="helper">Manual runs at a fixed mist level instead of holding a target humidity.</div>
      `;
    }

    return html`
      <div class="field">
        <div class="field-line">
          <span>Mist level</span><span class="field-value">${mist.value ?? "--"}</span>
        </div>
        ${this._renderSlider({
          key: "mist",
          label: "Mist level",
          min: mist.min,
          max: mist.max,
          step: mist.step,
          value: mist.value ?? mist.min,
          valueText: (value) => `Level ${value}`,
          disabled,
          showStops: true,
          onCommit: (level) => this._run(this._services!.fogLevel(level), { key: "mist", value: level }),
        })}
      </div>
    `;
  }

  private _renderSettings(view: DreoModel) {
    const s = view.settings;
    const disabled = !view.available;
    const toggles: { key: SwitchKey; label: string; on: string; off: string }[] = [
      { key: "display", label: "Display", on: "mdi:monitor", off: "mdi:monitor-off" },
      { key: "panelSound", label: "Sound", on: "mdi:volume-high", off: "mdi:volume-off" },
      { key: "schedule", label: "Schedule", on: "mdi:calendar-clock", off: "mdi:calendar-remove-outline" },
    ];
    const available = toggles.filter((toggle) => s[toggle.key] !== null);
    const thresholds = s.lightLow !== null && s.lightHigh !== null;
    if (!available.length && s.ambientLight === null && !thresholds) return nothing;

    return html`
      <section class="section">
        <div class="section-head">
          <ha-icon icon="mdi:cog-outline"></ha-icon>
          <span class="section-title">Settings</span>
        </div>
        <div class="row">
          ${s.ambientLight !== null
            ? this._toggle("Light", s.ambientLight ? "mdi:lightbulb-on-outline" : "mdi:lightbulb-outline", s.ambientLight, disabled, "ambientLight", () =>
                this._run(this._services!.ambientLight(!s.ambientLight), { key: "ambientLight", value: !s.ambientLight }),
              )
            : nothing}
          ${available.map(({ key, label, on, off }) =>
            this._toggle(label, s[key] ? on : off, Boolean(s[key]), disabled, key, () =>
              this._run(this._services!.toggle(key, !s[key]), { key, value: !s[key] }),
            ),
          )}
        </div>
        ${thresholds && s.ambientLight !== false ? this._renderThresholds(view) : nothing}
        ${s.schedule ? html`<div class="helper">Following the schedule set in the Dreo app.</div>` : nothing}
      </section>
    `;
  }

  private _renderThresholds(view: DreoModel) {
    const low = view.settings.lightLow!;
    const high = view.settings.lightHigh!;
    const disabled = !view.available;
    const set = (which: "lightLow" | "lightHigh", value: number) =>
      this._run(this._services!.lightThreshold(which, value), { key: which, value });
    const stepper = (which: "lightLow" | "lightHigh", label: string, value: number, min: number, max: number) => html`
      <div class="threshold">
        <span class="threshold-label">${label}</span>
        <div class="stepper">
          <button
            class="icon-button interactive"
            aria-label=${`${label} ${THRESHOLD_STEP}% lower`}
            ?disabled=${disabled || value - THRESHOLD_STEP < min}
            @click=${() => set(which, value - THRESHOLD_STEP)}
          >
            <ha-icon icon="mdi:minus"></ha-icon>
          </button>
          <output class=${classMap({ pending: this._pending.has(which) })} aria-live="polite">${value}%</output>
          <button
            class="icon-button interactive"
            aria-label=${`${label} ${THRESHOLD_STEP}% higher`}
            ?disabled=${disabled || value + THRESHOLD_STEP > max}
            @click=${() => set(which, value + THRESHOLD_STEP)}
          >
            <ha-icon icon="mdi:plus"></ha-icon>
          </button>
        </div>
      </div>
    `;

    return html`
      <div class="field">
        <div class="field-line"><span>Light ring colors</span></div>
        <div class="thresholds">
          ${stepper("lightLow", "Dry below", low, 0, high - THRESHOLD_GAP)}
          ${stepper("lightHigh", "Humid above", high, low + THRESHOLD_GAP, 100)}
        </div>
        <div class="helper">The ambient light shows room humidity: one color below ${low}%, another above ${high}%.</div>
      </div>
    `;
  }

  private _renderMaintenance(view: DreoModel) {
    const m = view.maintenance;
    if (m.filterLife === null && m.useSinceCleaning === null && m.filterActive === null) return nothing;
    const attention = m.filterLife !== null && m.filterLife <= LOW_FILTER_PERCENT;

    return html`
      <section class="section">
        <button
          class="section-head expander"
          aria-expanded=${this._maintenanceOpen ? "true" : "false"}
          @click=${() => (this._maintenanceOpen = !this._maintenanceOpen)}
        >
          <ha-icon icon="mdi:wrench-outline"></ha-icon>
          <span class="section-title">Maintenance</span>
          ${attention ? html`<span class="attention-dot" aria-label="Needs attention"></span>` : nothing}
          <span class="section-value">${m.filterLife !== null ? `Filter ${m.filterLife}%` : ""}</span>
          <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
        </button>
        ${this._maintenanceOpen
          ? html`
              ${m.filterLife !== null
                ? html`<div class="maintenance-item">
                    <div class="maintenance-line">
                      <span>Filter${m.filterActive === false ? " (not in use)" : ""}</span>
                      <span>${m.filterLife}% left</span>
                    </div>
                    <div
                      class="progress"
                      role="progressbar"
                      aria-label="Filter life"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow=${m.filterLife}
                      style=${styleMap({ "--fraction": String(m.filterLife / 100) })}
                    >
                      <div class=${classMap({ "progress-active": true, low: attention })}></div>
                      <div class="progress-inactive"></div>
                    </div>
                  </div>`
                : nothing}
              ${m.useSinceCleaning !== null
                ? html`<div class="maintenance-item">
                    <div class="maintenance-line">
                      <span>Run time since cleaning</span><span>${formatHours(m.useSinceCleaning)}</span>
                    </div>
                  </div>`
                : nothing}
            `
          : nothing}
      </section>
    `;
  }
}

if (!customElements.get(__CARD_TAG__)) {
  customElements.define(__CARD_TAG__, DreoHumidifierCard);
  const cards = ((window as any).customCards ??= []);
  cards.push({
    type: __CARD_TAG__,
    name: __CARD_TAG__.endsWith("-dev") ? "Dreo Humidifier (dev)" : "Dreo Humidifier",
    description: "Mode, target humidity, mist, light and maintenance controls for Dreo humidifiers.",
    preview: true,
    documentationURL: "https://github.com/brycewc/ha-card-dreo-humidifier",
  });
}
