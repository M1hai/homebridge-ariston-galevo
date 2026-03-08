# homebridge-ariston-galevo

Homebridge plugin for Ariston GALEVO boilers (Clas One, Genus One) via the Ariston NET cloud API.

## Features

- **Heating Flow** — Off/Heat mode toggle (Summer/Winter) with flow temperature control
- **Hot Water** — DHW temperature control
- Automatic polling with configurable interval
- Auto re-authentication on token expiry
- Dynamic temperature ranges from the API

## Installation

```bash
npm install -g homebridge-ariston-galevo
```

Or search for "Ariston GALEVO" in the Homebridge UI plugins tab.

## Configuration

Add the following to your Homebridge `config.json` under `platforms`:

```json
{
  "platform": "AristonGalevo",
  "name": "Ariston GALEVO",
  "username": "your-ariston-net-email",
  "password": "your-ariston-net-password",
  "pollInterval": 60
}
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `username` | Yes | — | Ariston NET account email |
| `password` | Yes | — | Ariston NET account password |
| `pollInterval` | No | 60 | Polling interval in seconds (minimum 30) |

## Requirements

- An Ariston GALEVO boiler with WiFi connectivity
- An Ariston NET account (the same one used in the Ariston NET app)
- Homebridge >= 1.6.0

## How it works

The plugin communicates with the Ariston NET cloud API (the same API used by the official Ariston NET app). It discovers your GALEVO device automatically and exposes two thermostats in HomeKit:

- **Heating Flow** — Controls the plant mode (Off = Summer/DHW only, Heat = Winter/heating + DHW) and the heating flow target temperature
- **Hot Water** — Controls the domestic hot water target temperature

## Support

If you find this plugin useful, consider buying me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-donate-yellow.svg)](https://buymeacoffee.com/m1hai)

## License

ISC
