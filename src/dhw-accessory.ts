import {
  Service,
  CharacteristicValue,
  PlatformAccessory,
  Characteristic,
} from "homebridge";
import { AristonGalevoPlatform } from "./platform";

const SET_DEBOUNCE_MS = 500;

export class DhwAccessory {
  private service: Service;
  private Characteristic: typeof Characteristic;

  // Cached state
  private currentTemp = 40;
  private targetTemp = 50;
  private polledOnce = false;
  private tempMin = 36;
  private tempMax = 60;
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
      .setCharacteristic(this.Characteristic.Model, "GALEVO DHW")
      .setCharacteristic(this.Characteristic.SerialNumber, this.platform.gwId ?? "unknown");

    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat, "Hot Water");

    this.service.setCharacteristic(this.Characteristic.Name, "Hot Water");

    // DHW is always on — lock mode to HEAT
    this.service
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [this.Characteristic.TargetHeatingCoolingState.HEAT],
      });

    this.service
      .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.Characteristic.CurrentHeatingCoolingState.HEAT);

    this.service
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(() => this.Characteristic.TargetHeatingCoolingState.HEAT);

    this.service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .setProps({ minValue: -40, maxValue: 100 })
      .onGet(() => this.currentTemp);

    this.service
      .getCharacteristic(this.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.tempMin,
        maxValue: this.tempMax,
        minStep: this.tempStep,
      })
      .onGet(() => this.targetTemp)
      .onSet((value: CharacteristicValue) => this.setTargetTemp(value));

    this.service
      .getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.Characteristic.TemperatureDisplayUnits.CELSIUS);
  }

  async setTargetTemp(value: CharacteristicValue): Promise<void> {
    const newTemp = value as number;
    if (newTemp === this.targetTemp) return;
    if (!this.polledOnce) {
      this.platform.log.warn("Ignoring DHW temp set before first poll");
      return;
    }

    // Debounce: wait for user to stop scrubbing the slider
    if (this.setTempTimer) clearTimeout(this.setTempTimer);
    const prevTemp = this.targetTemp;
    this.targetTemp = newTemp;

    this.setTempTimer = setTimeout(async () => {
      this.platform.log.info("Setting DHW temp from %d to %d", prevTemp, newTemp);
      try {
        await this.platform.apiClient.setState(this.platform.gwId!, [
          {
            id: "DhwTemp",
            prevValue: prevTemp,
            value: newTemp,
            zone: 0,
          },
        ]);
      } catch (err) {
        this.platform.log.error("Failed to set DHW temp: %s", err);
        this.targetTemp = prevTemp;
      }
    }, SET_DEBOUNCE_MS);
  }

  updateState(items: Map<string, any>): void {
    // Current DHW temperature
    const storageTemp = items.get("DhwStorageTemperature") ?? items.get("DhwTemp");
    if (storageTemp !== undefined) {
      this.currentTemp = storageTemp;
      this.service.updateCharacteristic(
        this.Characteristic.CurrentTemperature,
        this.currentTemp,
      );
    }

    // Target DHW temperature from raw item (includes min/max/step)
    const dhwItem = items.get("_DhwTemp_raw");
    if (dhwItem) {
      this.targetTemp = dhwItem.value;
      this.polledOnce = true;

      // Update min/max/step from API if available
      if (dhwItem.min !== undefined && dhwItem.max !== undefined) {
        this.tempMin = dhwItem.min;
        this.tempMax = dhwItem.max;
        this.tempStep = dhwItem.step ?? 1;

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
