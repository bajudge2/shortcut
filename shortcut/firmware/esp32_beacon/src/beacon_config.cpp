#include "beacon_config.h"

#include <Arduino.h>
#include <Preferences.h>
#include <esp_mac.h>
#include <string.h>

namespace cnav {

namespace {
constexpr const char *kNamespace = "cnav";
constexpr uint8_t kSchemaVersion = 1;  // bump if the stored layout changes

// NVS keys (max 15 chars).
constexpr const char *kKeySchema = "schema";
constexpr const char *kKeyId = "id";
constexpr const char *kKeyTx = "tx";
constexpr const char *kKeyAdv = "adv";
constexpr const char *kKeyMeasured = "mp";
constexpr const char *kKeyPathLoss = "pl";
constexpr const char *kKeyPin = "pin";
constexpr const char *kKeyRev = "rev";

void copyStr(char *dst, size_t cap, const char *src) {
  strncpy(dst, src, cap - 1);
  dst[cap - 1] = '\0';
}
}  // namespace

BeaconConfig defaultConfig() {
  BeaconConfig cfg{};
  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_BT);
  snprintf(cfg.id, sizeof(cfg.id), "U%02X%02X", mac[4], mac[5]);
  cfg.txPowerDbm = 3;      // supported on ESP32 and ESP32-S3
  cfg.advIntervalMs = 40;  // fast enough for smooth RSSI, modest power use
  cfg.measuredPower = -59; // typical 1 m RSSI; replace with a real calibration
  cfg.pathLossX10 = 20;    // 2.0 = free space
  cfg.pin[0] = '\0';
  cfg.rev = 0;
  return cfg;
}

bool isValidId(const char *id) {
  if (id == nullptr) return false;
  size_t n = strlen(id);
  if (n == 0 || n > kIdMaxLen) return false;
  for (size_t i = 0; i < n; ++i) {
    char c = id[i];
    bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    if (!ok) return false;
  }
  return true;
}

bool ConfigStore::load(BeaconConfig &cfg) {
  cfg = defaultConfig();
  Preferences prefs;
  // Open read-write so Preferences can create the namespace on a fresh board without
  // logging an expected NOT_FOUND error. This does not write any config keys.
  if (!prefs.begin(kNamespace, /*readOnly=*/false)) return false;
  if (prefs.getUChar(kKeySchema, 0) != kSchemaVersion) {
    prefs.end();
    return false;
  }

  BeaconConfig loaded = cfg;
  String id = prefs.getString(kKeyId, "");
  if (isValidId(id.c_str())) copyStr(loaded.id, sizeof(loaded.id), id.c_str());
  loaded.txPowerDbm = prefs.getChar(kKeyTx, cfg.txPowerDbm);
  loaded.advIntervalMs = prefs.getUShort(kKeyAdv, cfg.advIntervalMs);
  loaded.measuredPower = prefs.getChar(kKeyMeasured, cfg.measuredPower);
  loaded.pathLossX10 = prefs.getUChar(kKeyPathLoss, cfg.pathLossX10);
  String pin = prefs.isKey(kKeyPin) ? prefs.getString(kKeyPin, "") : String();
  copyStr(loaded.pin, sizeof(loaded.pin), pin.c_str());
  loaded.rev = prefs.getULong(kKeyRev, 0);
  prefs.end();

  // Defensive range checks so a corrupted value can't brick advertising.
  if (loaded.advIntervalMs < limits::kAdvIntervalMinMs || loaded.advIntervalMs > limits::kAdvIntervalMaxMs) {
    loaded.advIntervalMs = cfg.advIntervalMs;
  }
  if (loaded.measuredPower < limits::kMeasuredPowerMin || loaded.measuredPower > limits::kMeasuredPowerMax) {
    loaded.measuredPower = cfg.measuredPower;
  }
  if (loaded.pathLossX10 < limits::kPathLossMin * 10 || loaded.pathLossX10 > limits::kPathLossMax * 10) {
    loaded.pathLossX10 = cfg.pathLossX10;
  }
  cfg = loaded;
  return true;
}

bool ConfigStore::save(const BeaconConfig &cfg) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, /*readOnly=*/false)) return false;
  bool ok = true;
  ok &= prefs.putString(kKeyId, cfg.id) > 0;
  ok &= prefs.putChar(kKeyTx, cfg.txPowerDbm) > 0;
  ok &= prefs.putUShort(kKeyAdv, cfg.advIntervalMs) > 0;
  ok &= prefs.putChar(kKeyMeasured, cfg.measuredPower) > 0;
  ok &= prefs.putUChar(kKeyPathLoss, cfg.pathLossX10) > 0;
  // putString("") returns 0 bytes written, so check the pin separately.
  if (cfg.pin[0] == '\0') {
    if (prefs.isKey(kKeyPin)) prefs.remove(kKeyPin);
  } else {
    ok &= prefs.putString(kKeyPin, cfg.pin) > 0;
  }
  ok &= prefs.putULong(kKeyRev, cfg.rev) > 0;
  // Schema written last so an interrupted first save falls back to defaults on boot.
  ok &= prefs.putUChar(kKeySchema, kSchemaVersion) > 0;
  prefs.end();
  return ok;
}

bool ConfigStore::erase() {
  Preferences prefs;
  if (!prefs.begin(kNamespace, /*readOnly=*/false)) return false;
  bool ok = prefs.clear();
  prefs.end();
  return ok;
}

}  // namespace cnav
