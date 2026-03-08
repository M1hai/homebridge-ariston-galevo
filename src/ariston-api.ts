import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://www.ariston-net.remotethermo.com/api/v2/";

export interface DataItem {
  id: string;
  value: number;
  zone: number;
  min?: number;
  max?: number;
  step?: number;
  options?: number[];
  optTexts?: string[];
}

export interface Plant {
  gw: string;
  sys: number;
  name?: string;
}

export interface SetItem {
  id: string;
  value: number;
  prevValue: number;
  zone: number;
}

export class AristonAPI {
  private token: string | null = null;
  private username = "";
  private password = "";
  private client: AxiosInstance;
  private log: (msg: string) => void;

  constructor(log: (msg: string) => void) {
    this.log = log;
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        "User-Agent": "RestSharp/106.11.7.0",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  async login(username: string, password: string): Promise<void> {
    this.username = username;
    this.password = password;
    const res = await this.client.post("accounts/login", {
      usr: username,
      pwd: password,
    });
    this.token = res.data.token;
    this.log("Logged in to Ariston NET");
  }

  private async reauth(): Promise<void> {
    this.log("Re-authenticating...");
    await this.login(this.username, this.password);
  }

  private authHeaders() {
    return { "ar.authToken": this.token ?? "" };
  }

  private async request<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.response?.status === 405) {
        await this.reauth();
        return await fn();
      }
      throw err;
    }
  }

  async getPlants(): Promise<Plant[]> {
    return this.request(async () => {
      const res = await this.client.get("remote/plants", {
        headers: this.authHeaders(),
      });
      return res.data;
    });
  }

  async getFeatures(gwId: string): Promise<any> {
    return this.request(async () => {
      const res = await this.client.get("remote/plants/" + gwId + "/features", {
        headers: this.authHeaders(),
      });
      return res.data;
    });
  }

  async getState(gwId: string, items: { id: string; zn: number }[]): Promise<DataItem[]> {
    const body = {
      useCache: false,
      items,
      features: {},
      culture: "en-US",
    };
    try {
      return await this.request(async () => {
        const res = await this.client.post(
          "remote/dataItems/" + gwId + "/get?umsys=si",
          body,
          { headers: this.authHeaders() },
        );
        return res.data.items ?? [];
      });
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return [];
      }
      throw err;
    }
  }

  async setState(gwId: string, items: SetItem[]): Promise<void> {
    const body = { items, features: {} };
    try {
      await this.request(async () => {
        await this.client.post(
          "remote/dataItems/" + gwId + "/set?umsys=si",
          body,
          { headers: this.authHeaders() },
        );
      });
    } catch (err: any) {
      if (err?.response?.status === 429) {
        this.log("Rate limited by Ariston API, will retry next poll");
        return;
      }
      throw err;
    }
  }
}
