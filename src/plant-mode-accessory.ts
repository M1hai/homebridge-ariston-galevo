import {
  Service,
  CharacteristicValue,
  PlatformAccessory,
  Characteristic,
} from "homebridge";
import { AristonGalevoPlatform } from "./platform";

// PlantMode values: 0=Summer(DHW only), 1=Winter(heating+DHW)
const PLANT_MODE_SUMMER = 0;
const PLANT_MODE_WINTER = 1;

const SET_DEBOUNCE_MS = 500;

export class PlantModeAccessory {
  private service: Service;
  private Characteristic: typeof Characteristic;

  // Cached state
  private plantMode = PLANT_MODE_SUMMER;
  private currentTemp = 35;
  private targetTemp = 35;
  private tempMin = 35;
  private tempMax = 82;
  private tempStep = 1;
  private setTempTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly platform: AristonGalevoPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.Characteristic = this.platform.Characteristic;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, "Ariston")
      .setCharacteristic(this.Characteristic.Model, "GALEVO")
      .setCharacteristic(this.Characteristic.SerialNumber, this.platform.gwId ?? "unknown");

    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat, "Heating Flow");

    this.service.setCharacteristic(this.Characteristic.Name, "Heating Flow");

    // Only OFF and HEAT
    this.service
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.Characteristic.TargetHeatingCoolingState.OFF,
          this.Characteristic.TargetHeatingCoolingState.HEAT,
        ],
      });

    this.service
      .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.getCurrentState());

    this.service
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(() => this.getTargetState())
      .onSet((value: CharacteristicValue) => this.setTargetState(value));

    this.service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .setProps({ minValue: -40, maxValue: 100 })
      .onGet(() => this.currentTemp);

    this.service
      .getCharacteristic(this.Characteristic.TargetTemperature)
      .setProps({ minValue: this.tempMin, maxValue: this.tempMax, minStep: this.tempStep })
      .onGet(() => this.targetTemp)
      .onSet((value: CharacteristicValue) => this.setTargetTemp(value));

    this.service
      .getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.Characteristic.TemperatureDisplayUnits.CELSIUS);
  }

  getCurrentState(): number {
    return this.plantMode === PLANT_MODE_WINTER
      ? this.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  getTargetState(): number {
    return this.plantMode === PLANT_MODE_WINTER
      ? this.Characteristic.TargetHeatingCoolingState.HEAT
      : this.Characteristic.TargetHeatingCoolingState.OFF;
  }

  async setTargetState(value: CharacteristicValue): Promise<void> {
    const newPlantMode = value === this.Characteristic.TargetHeatingCoolingState.HEAT
      ? PLANT_MODE_WINTER
      : PLANT_MODE_SUMMER;
    if (newPlantMode === this.plantMode) return;

    this.platform.log.info("Setting PlantMode from %d to %d", this.plantMode, newPlantMode);
    try {
      await this.platform.apiClient.setState(this.platform.gwId!, [
        {
          id: "PlantMode",
          prevValue: this.plantMode,
          value: newPlantMode,
          zone: 0,
        },
      ]);
      this.plantMode = newPlantMode;
      this.service.updateCharacteristic(
        this.Characteristic.CurrentHeatingCoolingState,
        this.getCurrentState(),
      );
    } catch (err) {
      this.platform.log.error("Failed to set PlantMode: %s", err);
      throw err;
    }
  }

  async setTargetTemp(value: CharacteristicValue): Promise<void> {
    const newTemp = value as number;
    if (newTemp === this.targetTemp) return;

    // Debounce: wait for user to stop scrubbing the slider
    if (this.setTempTimer) clearTimeout(this.setTempTimer);
    const prevTemp = this.targetTemp;
    this.targetTemp = newTemp;

    this.setTempTimer = setTimeout(async () => {
      this.platform.log.info("Setting HeatingFlowTemp from %d to %d", prevTemp, newTemp);
      try {
        await this.platform.apiClient.setState(this.platform.gwId!, [
          {
            id: "HeatingFlowTemp",
            prevValue: prevTemp,
            value: newTemp,
            zone: 1,
          },
        ]);
      } catch (err) {
        this.platform.log.error("Failed to set HeatingFlowTemp: %s", err);
        this.targetTemp = prevTemp;
      }
    }, SET_DEBOUNCE_MS);
  }

  updateState(items: Map<string, any>): void {
    const pm = items.get("PlantMode");
    if (pm !== undefined) {
      this.plantMode = pm;
      this.service.updateCharacteristic(
        this.Characteristic.CurrentHeatingCoolingState,
        this.getCurrentState(),
      );
      this.service.updateCharacteristic(
        this.Characteristic.TargetHeatingCoolingState,
        this.getTargetState(),
      );
    }

    const currentTemp = items.get("ChFlowSetpointTemp");
    if (currentTemp !== undefined) {
      this.currentTemp = currentTemp;
      this.service.updateCharacteristic(
        this.Characteristic.CurrentTemperature,
        this.currentTemp,
      );
    }

    // Target HeatingFlowTemp from raw item (includes min/max/step)
    const heatingRaw = items.get("_HeatingFlowTemp_raw");
    if (heatingRaw) {
      this.targetTemp = heatingRaw.value;

      if (heatingRaw.min !== undefined && heatingRaw.max !== undefined) {
        this.tempMin = heatingRaw.min;
        this.tempMax = heatingRaw.max;
        this.tempStep = heatingRaw.step ?? 1;

        this.service
          .getCharacteristic(this.Characteristic.TargetTemperature)
          .setProps({
            minValue: this.tempMin,
            maxValue: this.tempMax,
            minStep: this.tempStep,
          });
      }

      this.service.updateCharacteristic(
        this.Characteristic.TargetTemperature,
        this.targetTemp,
      );
    }
  }
}
