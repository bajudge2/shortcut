#pragma once
// Beacon identity + calibration. Nothing here is compiled in per board: values come
// from NVS (flash) and are changed at runtime over BLE or serial.
#include <stddef.h>
#include <stdint.h>

namespace cnav {

constexpr size_t kIdMaxLen = 8;   // "CNAV-" + 8 chars keeps the scan response under 31 bytes
constexpr size_t kPinMaxLen = 16;

struct BeaconConfig {
  char id[kIdMaxLen + 1];      // beacon id, must match building.json "beacons[].id"
  int8_t txPowerDbm;           // radio TX power (snapped to what the chip supports)
  uint16_t advIntervalMs;      // advertising interval
  int8_t measuredPower;        // calibrated RSSI at 1 m (dBm), broadcast for distance math
  uint8_t pathLossX10;         // path-loss exponent * 10, broadcast for distance math
  char pin[kPinMaxLen + 1];    // optional; when set, BLE writes must include "auth"
  uint32_t rev;                // bumps on every saved change
};

// Accepted ranges (the BLE spec limits the interval to 20 ms .. 10.24 s).
namespace limits {
constexpr int kAdvIntervalMinMs = 20;
constexpr int kAdvIntervalMaxMs = 10240;
constexpr int kMeasuredPowerMin = -120;
constexpr int kMeasuredPowerMax = 0;
constexpr float kPathLossMin = 1.0f;
constexpr float kPathLossMax = 6.0f;
constexpr int kTxPowerMin = -30;  // requests are snapped to the nearest supported level
constexpr int kTxPowerMax = 25;
}  // namespace limits

// Factory defaults. The id is derived from the chip MAC so a fresh board is unique
// and harmless (the app ignores ids that aren't in building.json) until it is named.
BeaconConfig defaultConfig();

// Ids are 1..8 chars of [A-Za-z0-9_-].
bool isValidId(const char *id);

// Persists BeaconConfig in NVS (Preferences namespace "cnav").
class ConfigStore {
 public:
  // Fills cfg from flash; returns false (and fills defaults) if nothing valid is stored.
  bool load(BeaconConfig &cfg);
  bool save(const BeaconConfig &cfg);
  bool erase();
};

}  // namespace cnav
