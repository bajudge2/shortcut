#include "config_service.h"

#include <ArduinoJson.h>
#include <esp_mac.h>
#include <math.h>
#include <string.h>

#include "beacon_radio.h"
#include "protocol.h"

namespace cnav {

namespace {

constexpr const char *kSettingKeys[] = {"id", "txPower", "advInterval", "measuredPower", "pathLoss", "pin"};
constexpr const char *kMetaKeys[] = {"cmd", "auth"};

// Brute-force guard for the optional PIN (BLE only).
constexpr uint8_t kMaxAuthFailures = 5;
constexpr uint32_t kAuthLockoutMs = 30000;
uint8_t authFailures = 0;
uint32_t authLockedUntil = 0;

bool isKnownKey(const char *key) {
  for (const char *k : kSettingKeys) if (strcmp(k, key) == 0) return true;
  for (const char *k : kMetaKeys) if (strcmp(k, key) == 0) return true;
  return false;
}

bool hasSetting(JsonObjectConst req) {
  for (const char *k : kSettingKeys) if (!req[k].isNull()) return true;
  return false;
}

// Compares without early exit so timing doesn't leak how much of the PIN matched.
bool pinMatches(const char *given, const char *pin) {
  size_t a = strlen(given), b = strlen(pin);
  uint8_t diff = a == b ? 0 : 1;
  for (size_t i = 0; i < b; ++i) diff |= static_cast<uint8_t>(pin[i] ^ (i < a ? given[i] : 0));
  return diff == 0;
}

bool isValidPin(const char *pin) {
  size_t n = strlen(pin);
  if (n > kPinMaxLen) return false;
  for (size_t i = 0; i < n; ++i) if (pin[i] < 0x21 || pin[i] > 0x7E) return false;  // printable, no spaces
  return true;
}

bool sameConfig(const BeaconConfig &a, const BeaconConfig &b) {
  return strcmp(a.id, b.id) == 0 && a.txPowerDbm == b.txPowerDbm && a.advIntervalMs == b.advIntervalMs &&
         a.measuredPower == b.measuredPower && a.pathLossX10 == b.pathLossX10 && strcmp(a.pin, b.pin) == 0;
}

String reply(bool ok, const char *cmd, uint32_t rev, const char *err = nullptr, const char *field = nullptr,
             bool changed = false) {
  JsonDocument doc;
  doc["ok"] = ok;
  if (cmd != nullptr) doc["cmd"] = cmd;
  doc["rev"] = rev;
  if (ok) doc["changed"] = changed;
  if (err != nullptr) doc["err"] = err;
  if (field != nullptr) doc["field"] = field;
  String out;
  serializeJson(doc, out);
  return out;
}

}  // namespace

RequestResult ConfigService::handle(const char *json, size_t len, Source src) {
  RequestResult r;
  auto fail = [&](const char *cmd, const char *err, const char *field = nullptr) {
    r.status = reply(false, cmd, cfg_.rev, err, field);
    return r;
  };

  if (len == 0) return fail(nullptr, "empty or too long request");

  JsonDocument doc;
  DeserializationError jsonErr = deserializeJson(doc, json, len);
  if (jsonErr) return fail(nullptr, "invalid json");
  if (!doc.is<JsonObjectConst>()) return fail(nullptr, "expected a json object");
  JsonObjectConst req = doc.as<JsonObjectConst>();

  for (JsonPairConst kv : req) {
    if (!isKnownKey(kv.key().c_str())) return fail(nullptr, "unknown field", kv.key().c_str());
  }

  const bool settings = hasSetting(req);
  if (!req["cmd"].isNull() && !req["cmd"].is<const char *>()) return fail(nullptr, "cmd must be a string", "cmd");
  const char *cmd = req["cmd"] | (settings ? "set" : "get");

  if (strcmp(cmd, "get") == 0) {
    if (settings) return fail(cmd, "get takes no settings");
    r.status = reply(true, cmd, cfg_.rev);
    return r;
  }
  if (strcmp(cmd, "set") != 0 && strcmp(cmd, "reboot") != 0 && strcmp(cmd, "factory_reset") != 0) {
    return fail(cmd, "unknown cmd", "cmd");
  }
  if (strcmp(cmd, "set") != 0 && settings) return fail(cmd, "settings only allowed with cmd set");

  // Anything that changes state needs the PIN over BLE (when one is set).
  if (src == Source::Ble && cfg_.pin[0] != '\0') {
    if (authLockedUntil != 0 && static_cast<int32_t>(millis() - authLockedUntil) < 0) {
      return fail(cmd, "locked out, retry later", "auth");
    }
    const char *auth = req["auth"].is<const char *>() ? req["auth"].as<const char *>() : "";
    if (!pinMatches(auth, cfg_.pin)) {
      if (++authFailures >= kMaxAuthFailures) {
        authFailures = 0;
        authLockedUntil = millis() + kAuthLockoutMs;
      }
      return fail(cmd, "bad or missing auth", "auth");
    }
    authFailures = 0;
    authLockedUntil = 0;
  }

  if (strcmp(cmd, "reboot") == 0) {
    r.status = reply(true, cmd, cfg_.rev);
    r.reboot = true;
    return r;
  }

  if (strcmp(cmd, "factory_reset") == 0) {
    BeaconConfig next = defaultConfig();
    next.rev = cfg_.rev + 1;  // keep rev increasing so phones notice the change
    if (!store_.erase() || !store_.save(next)) return fail(cmd, "flash write failed");
    cfg_ = next;
    r.status = reply(true, cmd, cfg_.rev, nullptr, nullptr, true);
    r.radioChanged = true;
    return r;
  }

  // cmd == "set": validate everything first, then apply atomically.
  BeaconConfig next = cfg_;

  JsonVariantConst v = req["id"];
  if (!v.isNull()) {
    if (!v.is<const char *>() || !isValidId(v.as<const char *>())) return fail(cmd, "id must be 1-8 chars A-Z a-z 0-9 _ -", "id");
    strncpy(next.id, v.as<const char *>(), kIdMaxLen);
    next.id[kIdMaxLen] = '\0';
  }

  v = req["txPower"];
  if (!v.isNull()) {
    if (!v.is<int>() || v.as<int>() < limits::kTxPowerMin || v.as<int>() > limits::kTxPowerMax) {
      return fail(cmd, "txPower must be an integer dBm (-30..25)", "txPower");
    }
    next.txPowerDbm = BeaconRadio::snapTxPower(v.as<int>());
  }

  v = req["advInterval"];
  if (!v.isNull()) {
    if (!v.is<int>() || v.as<int>() < limits::kAdvIntervalMinMs || v.as<int>() > limits::kAdvIntervalMaxMs) {
      return fail(cmd, "advInterval must be an integer ms (20..10240)", "advInterval");
    }
    next.advIntervalMs = static_cast<uint16_t>(v.as<int>());
  }

  v = req["measuredPower"];
  if (!v.isNull()) {
    if (!v.is<int>() || v.as<int>() < limits::kMeasuredPowerMin || v.as<int>() > limits::kMeasuredPowerMax) {
      return fail(cmd, "measuredPower must be an integer dBm (-120..0)", "measuredPower");
    }
    next.measuredPower = static_cast<int8_t>(v.as<int>());
  }

  v = req["pathLoss"];
  if (!v.isNull()) {
    if (!v.is<float>() || v.as<float>() < limits::kPathLossMin || v.as<float>() > limits::kPathLossMax) {
      return fail(cmd, "pathLoss must be a number (1.0..6.0)", "pathLoss");
    }
    next.pathLossX10 = static_cast<uint8_t>(lroundf(v.as<float>() * 10.0f));
  }

  v = req["pin"];
  if (!v.isNull()) {
    if (!v.is<const char *>() || !isValidPin(v.as<const char *>())) {
      return fail(cmd, "pin must be 0-16 printable chars without spaces (\"\" clears it)", "pin");
    }
    strncpy(next.pin, v.as<const char *>(), kPinMaxLen);
    next.pin[kPinMaxLen] = '\0';
  }

  if (sameConfig(next, cfg_)) {
    r.status = reply(true, cmd, cfg_.rev, nullptr, nullptr, false);
    return r;
  }

  next.rev = cfg_.rev + 1;
  if (!store_.save(next)) return fail(cmd, "flash write failed");
  cfg_ = next;
  r.status = reply(true, cmd, cfg_.rev, nullptr, nullptr, true);
  r.radioChanged = true;
  return r;
}

String ConfigService::configJson() const {
  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_BT);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  JsonDocument doc;
  doc["v"] = kMfgFormatVersion;
  doc["fw"] = kFirmwareVersion;
  doc["chip"] = ESP.getChipModel();
  doc["mac"] = macStr;
  doc["id"] = cfg_.id;
  doc["name"] = String(kNamePrefix) + cfg_.id;
  doc["txPower"] = cfg_.txPowerDbm;
  doc["advInterval"] = cfg_.advIntervalMs;
  doc["measuredPower"] = cfg_.measuredPower;
  doc["pathLoss"] = cfg_.pathLossX10 / 10.0;
  doc["rev"] = cfg_.rev;
  doc["locked"] = cfg_.pin[0] != '\0';
  String out;
  serializeJson(doc, out);
  return out;
}

}  // namespace cnav
