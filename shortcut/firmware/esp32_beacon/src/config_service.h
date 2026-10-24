#pragma once
// Parses and applies JSON config requests. Same handler for BLE (from the iOS app)
// and USB serial (bench setup / when the app isn't ready).
#include <Arduino.h>

#include "beacon_config.h"

namespace cnav {

enum class Source { Ble, Serial };

struct RequestResult {
  String status;         // short JSON reply, e.g. {"ok":true,"cmd":"set","rev":4}
  bool radioChanged = false;  // advertising must be rebuilt
  bool reboot = false;        // restart after replying
};

class ConfigService {
 public:
  ConfigService(ConfigStore &store, BeaconConfig &cfg) : store_(store), cfg_(cfg) {}

  // Handles one request. Serial requests are trusted (physical access) and skip the PIN.
  RequestResult handle(const char *json, size_t len, Source src);

  // Full current config as JSON (what the config characteristic returns on READ).
  String configJson() const;

 private:
  ConfigStore &store_;
  BeaconConfig &cfg_;
};

}  // namespace cnav
