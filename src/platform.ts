import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from "homebridge";
import { AristonAPI } from "./ariston-api";
import { PlantModeAccessory } from "./plant-mode-accessory";
import { DhwAccessory } from "./dhw-accessory";

const POLL_ITEMS = [
  { id: "PlantMode", zn: 0 },
  { id: "IsFlameOn", zn: 0 },
  { id: "DhwTemp", zn: 0 },
  { id: "DhwStorageTemperature", zn: 0 },
  { id: "ChFlowSetpointTemp", zn: 0 },
  { id: "HeatingFlowTemp", zn: 1 },
  { id: "OutsideTemp", zn: 0 },
];

export class AristonGalevoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly apiClient: AristonAPI;
  public gwId: string | null = null;

  private readonly accessories: PlatformAccessory[] = [];
  private plantModeAccessory: PlantModeAccessory | null = null;
  private dhwAccessory: DhwAccessory | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly log: Logger,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.apiClient = new AristonAPI((msg) => this.log.debug(msg));

    this.api.on("didFinishLaunching", () => {
      this.init().catch((err) => {
        this.log.error("Initialization failed: %s", err);
      });
    });

    this.api.on("shutdown", () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private async init(): Promise<void> {
    const { username, password, pollInterval = 60 } = this.config;
    if (!username || !password) {
      this.log.error("Username and password are required in config");
      return;
    }

    // Login
    try {
      await this.apiClient.login(username, password);
    } catch (err) {
      this.log.error("Login failed: %s", err);
      return;
    }

    // Discover devices
    let plants;
    try {
      plants = await this.apiClient.getPlants();
    } catch (err) {
      this.log.error("Failed to discover devices: %s", err);
      return;
    }

    const galevo = plants.find((p: any) => p.sys === 3);
    if (!galevo) {
      this.log.error("No GALEVO device found. Available plants: %s", JSON.stringify(plants));
      return;
    }

    this.gwId = galevo.gw;
    this.log.info("Found GALEVO device: %s", this.gwId);

    // Register accessories and clean up old ones
    this.registerAccessories();

    // Start polling
    const interval = Math.max(30, pollInterval) * 1000;
    this.log.info("Polling every %d seconds", interval / 1000);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), interval);
  }

  private registerAccessories(): void {
    const plantUuid = this.api.hap.uuid.generate(this.gwId + "-heating-flow-v1.1");
    const dhwUuid = this.api.hap.uuid.generate(this.gwId + "-dhw-v1.1");
    const activeUuids = new Set([plantUuid, dhwUuid]);

    // Remove any orphaned accessories from previous versions
    const orphans = this.accessories.filter((a) => !activeUuids.has(a.UUID));
    if (orphans.length > 0) {
      this.log.info("Removing %d orphaned accessory(ies): %s",
        orphans.length, orphans.map((a) => a.displayName).join(", "));
      this.api.unregisterPlatformAccessories("homebridge-ariston-galevo", "AristonGalevo", orphans);
    }

    // Heating Flow accessory
    let plantAcc = this.accessories.find((a) => a.UUID === plantUuid);
    if (!plantAcc) {
      this.log.info("Adding Heating Flow accessory");
      plantAcc = new this.api.platformAccessory("Heating Flow", plantUuid);
      this.api.registerPlatformAccessories("homebridge-ariston-galevo", "AristonGalevo", [plantAcc]);
    }
    this.plantModeAccessory = new PlantModeAccessory(this, plantAcc);

    // DHW accessory
    let dhwAcc = this.accessories.find((a) => a.UUID === dhwUuid);
    if (!dhwAcc) {
      this.log.info("Adding Hot Water accessory");
      dhwAcc = new this.api.platformAccessory("Hot Water", dhwUuid);
      this.api.registerPlatformAccessories("homebridge-ariston-galevo", "AristonGalevo", [dhwAcc]);
    }
    this.dhwAccessory = new DhwAccessory(this, dhwAcc);
  }

  private async poll(): Promise<void> {
    if (!this.gwId) return;

    try {
      const items = await this.apiClient.getState(this.gwId, POLL_ITEMS);
      if (!items.length) return;

      const stateMap = new Map<string, any>();
      for (const item of items) {
        stateMap.set(item.id, item.value);
      }

      // Store raw items for min/max/step
      const dhwRaw = items.find((i) => i.id === "DhwTemp");
      if (dhwRaw) {
        stateMap.set("_DhwTemp_raw", dhwRaw);
      }
      const heatingRaw = items.find((i) => i.id === "HeatingFlowTemp");
      if (heatingRaw) {
        stateMap.set("_HeatingFlowTemp_raw", heatingRaw);
      }

      this.plantModeAccessory?.updateState(stateMap);
      this.dhwAccessory?.updateState(stateMap);

      this.log.debug(
        "Poll: PlantMode=%s, ChFlowSetpointTemp=%s, DhwTemp=%s",
        stateMap.get("PlantMode"),
        stateMap.get("ChFlowSetpointTemp"),
        stateMap.get("DhwTemp"),
      );
    } catch (err: any) {
      if (err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT") {
        this.log.warn("Poll timed out, will retry next cycle");
      } else {
        this.log.error("Poll failed: %s", err);
      }
    }
  }
}
