import { API } from "homebridge";
import { AristonGalevoPlatform } from "./platform";

export default (api: API) => {
  api.registerPlatform("AristonGalevo", AristonGalevoPlatform);
};
