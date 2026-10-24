#include "beacon_radio.h"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <esp_bt.h>
#include <string.h>

#if defined(CONFIG_BLUEDROID_ENABLED)
#include <BLE2902.h>
#include <esp_gap_ble_api.h>
#endif
#if defined(CONFIG_NIMBLE_ENABLED)
#include "services/gap/ble_svc_gap.h"
#endif

namespace cnav {

namespace {

// Drop a phone that stays connected without writing anything (a stuck app shouldn't
// hold the beacon's connection slots forever). Advertising continues while connected.
constexpr uint32_t kIdleDisconnectMs = 120000;

struct PowerLevel {
  esp_power_level_t level;
  int8_t dbm;
};

#if defined(CONFIG_IDF_TARGET_ESP32)
constexpr PowerLevel kPowerLevels[] = {
    {ESP_PWR_LVL_N12, -12}, {ESP_PWR_LVL_N9, -9}, {ESP_PWR_LVL_N6, -6}, {ESP_PWR_LVL_N3, -3},
    {ESP_PWR_LVL_N0, 0},    {ESP_PWR_LVL_P3, 3},  {ESP_PWR_LVL_P6, 6},  {ESP_PWR_LVL_P9, 9},
};
#else  // ESP32-S3 / C3 family controller
constexpr PowerLevel kPowerLevels[] = {
    {ESP_PWR_LVL_N24, -24}, {ESP_PWR_LVL_N21, -21}, {ESP_PWR_LVL_N18, -18}, {ESP_PWR_LVL_N15, -15},
    {ESP_PWR_LVL_N12, -12}, {ESP_PWR_LVL_N9, -9},   {ESP_PWR_LVL_N6, -6},   {ESP_PWR_LVL_N3, -3},
    {ESP_PWR_LVL_N0, 0},    {ESP_PWR_LVL_P3, 3},    {ESP_PWR_LVL_P6, 6},    {ESP_PWR_LVL_P9, 9},
    {ESP_PWR_LVL_P12, 12},  {ESP_PWR_LVL_P15, 15},  {ESP_PWR_LVL_P18, 18},  {ESP_PWR_LVL_P20, 20},
};
#endif

const PowerLevel &nearestLevel(int dbm) {
  const PowerLevel *best = &kPowerLevels[0];
  for (const auto &p : kPowerLevels) {
    if (abs(p.dbm - dbm) < abs(best->dbm - dbm)) best = &p;
  }
  return *best;
}

// ms -> BLE advertising units (0.625 ms), clamped to the spec range.
uint16_t advUnits(uint32_t ms) {
  uint32_t u = (ms * 8) / 5;
  if (u < 0x20) u = 0x20;
  if (u > 0x4000) u = 0x4000;
  return static_cast<uint16_t>(u);
}

class ServerCallbacks : public BLEServerCallbacks {
 public:
  explicit ServerCallbacks(BeaconRadio &radio) : radio_(radio) {}
  void onConnect(BLEServer *) override { radio_.onConnectEvt(); }
  void onDisconnect(BLEServer *) override { radio_.onDisconnectEvt(); }

 private:
  BeaconRadio &radio_;
};

class ConfigCharCallbacks : public BLECharacteristicCallbacks {
 public:
  explicit ConfigCharCallbacks(BeaconRadio &radio) : radio_(radio) {}
  void onWrite(BLECharacteristic *c) override { radio_.onWriteEvt(c->getValue()); }

 private:
  BeaconRadio &radio_;
};

}  // namespace

int8_t BeaconRadio::snapTxPower(int dbm) { return nearestLevel(dbm).dbm; }

bool BeaconRadio::begin(const BeaconConfig &cfg) {
  Serial.println("[ble] creating request queue");
  requests_ = xQueueCreate(2, sizeof(Request));
  if (requests_ == nullptr) {
    Serial.println("[ble] ERROR: request queue allocation failed");
    return false;
  }

  String name = String(kNamePrefix) + cfg.id;
  Serial.printf("[ble] initializing stack as %s (free heap %lu)\n", name.c_str(),
                static_cast<unsigned long>(ESP.getFreeHeap()));
  if (!BLEDevice::init(name)) {
    Serial.println("[ble] ERROR: stack initialization failed");
    return false;
  }
  Serial.printf("[ble] stack synchronized (free heap %lu)\n", static_cast<unsigned long>(ESP.getFreeHeap()));
  if (BLEDevice::setMTU(247) != ESP_OK) Serial.println("[ble] WARNING: could not request MTU 247");

  Serial.println("[ble] creating GATT server");
  server_ = BLEDevice::createServer();
  if (server_ == nullptr) {
    Serial.println("[ble] ERROR: GATT server allocation failed");
    return false;
  }
  server_->setCallbacks(new ServerCallbacks(*this));
  // One restart owner avoids duplicate starts on Bluedroid. Callbacks schedule restarts in loop().
  server_->advertiseOnDisconnect(false);

  BLEService *svc = server_->createService(kServiceUuid);
  if (svc == nullptr) {
    Serial.println("[ble] ERROR: config service allocation failed");
    return false;
  }
  configChar_ = svc->createCharacteristic(
      kConfigCharUuid, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
  configChar_->setCallbacks(new ConfigCharCallbacks(*this));

  statusChar_ = svc->createCharacteristic(
      kStatusCharUuid, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  statusChar_->addDescriptor(new BLE2902());  // NimBLE adds the CCCD automatically
#endif
  statusChar_->setValue(String("{\"ok\":true}"));
  svc->start();
  Serial.println("[ble] GATT service started");

  ready_ = apply(cfg);
  if (ready_) Serial.println("[ble] advertising started");
  else Serial.println("[ble] ERROR: advertising failed to start");
  return ready_;
}

bool BeaconRadio::apply(const BeaconConfig &cfg) {
  if (!BLEDevice::getInitialized()) return false;
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  if (adv == nullptr) return false;

  if (advertising_) {
    bool stopped = adv->stop();
#if defined(CONFIG_BLUEDROID_ENABLED)
    // Bluedroid reports stop/config completion asynchronously. Give its GAP task time
    // to complete before replacing payloads; NimBLE setters are synchronous.
    delay(100);
#endif
    if (!stopped) Serial.println("[ble] WARNING: advertising stop was not acknowledged");
    advertising_ = false;
  }

  setDeviceName(String(kNamePrefix) + cfg.id);
  bool powerOk = setTxPower(cfg.txPowerDbm);

  uint16_t minUnits = advUnits(cfg.advIntervalMs);
  uint16_t maxUnits = advUnits(cfg.advIntervalMs + cfg.advIntervalMs / 4);  // small window
  adv->setMinInterval(minUnits);
  adv->setMaxInterval(maxUnits);

  bool payloadOk = buildAdvertising(cfg);
  bool startOk = payloadOk && startAdvertising();
  lastActivityMs_ = millis();
  ready_ = powerOk && startOk;
  return ready_;
}

bool BeaconRadio::buildAdvertising(const BeaconConfig &cfg) {
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  if (adv == nullptr) return false;

  // Primary packet: flags (3) + 128-bit service UUID (18) + TX power (3) = 24 of 31 bytes.
  BLEAdvertisementData primary;
  primary.setFlags(0x06);  // LE General Discoverable, BR/EDR not supported
  primary.setCompleteServices(BLEUUID(kServiceUuid));
  char tx[3] = {2, 0x0A, static_cast<char>(currentTxPowerDbm())};
  primary.addData(tx, sizeof(tx));
  if (!adv->setAdvertisementData(primary)) {
    Serial.println("[ble] ERROR: primary advertising payload rejected");
    return false;
  }
#if defined(CONFIG_BLUEDROID_ENABLED)
  delay(100);
#endif

  // Scan response: name (2 + up to 13) + manufacturer data (2 + 6) <= 23 of 31 bytes.
  BLEAdvertisementData scanRsp;
  scanRsp.setName(String(kNamePrefix) + cfg.id);
  char mfg[8] = {
      7,                                            // AD length (type + 6 payload bytes)
      static_cast<char>(0xFF),                      // AD type: manufacturer specific
      static_cast<char>(kMfgCompanyId & 0xFF),      // company id, little endian
      static_cast<char>(kMfgCompanyId >> 8),
      static_cast<char>(kMfgFormatVersion),
      static_cast<char>(cfg.measuredPower),
      static_cast<char>(cfg.pathLossX10),
      static_cast<char>(cfg.rev & 0xFF),
  };
  scanRsp.addData(mfg, sizeof(mfg));
  if (!adv->setScanResponseData(scanRsp)) {
    Serial.println("[ble] ERROR: scan-response payload rejected");
    return false;
  }
#if defined(CONFIG_BLUEDROID_ENABLED)
  delay(100);
#endif
  return true;
}

bool BeaconRadio::startAdvertising() {
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  advertising_ = adv != nullptr && adv->start();
  if (!advertising_) Serial.println("[ble] ERROR: advertising start rejected");
  return advertising_;
}

bool BeaconRadio::setTxPower(int8_t dbm) {
  esp_power_level_t level = nearestLevel(dbm).level;
  esp_err_t adv = esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, level);
  esp_err_t scan = esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_SCAN, level);
  esp_err_t fallback = esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, level);
  if (adv != ESP_OK || scan != ESP_OK || fallback != ESP_OK) {
    Serial.printf("[ble] ERROR: TX power rejected (adv=%d scan=%d default=%d)\n", adv, scan, fallback);
    return false;
  }
  return true;
}

int BeaconRadio::currentTxPowerDbm() const {
  esp_power_level_t level = esp_ble_tx_power_get(ESP_BLE_PWR_TYPE_ADV);
  for (const auto &p : kPowerLevels) {
    if (p.level == level) return p.dbm;
  }
  return 0;
}

void BeaconRadio::setDeviceName(const String &name) {
  // Updates the GAP Device Name characteristic; the advertised name comes from the scan response.
#if defined(CONFIG_BLUEDROID_ENABLED)
  esp_ble_gap_set_device_name(name.c_str());
#endif
#if defined(CONFIG_NIMBLE_ENABLED)
  ble_svc_gap_device_name_set(name.c_str());
#endif
}

void BeaconRadio::loop() {
  if (restartAdv_) {
    restartAdv_ = false;
    if (BLEDevice::getInitialized()) {
      advertising_ = false;  // connections stop legacy advertising before invoking the callback
      ready_ = startAdvertising();
    }
  }
  if (server_ != nullptr && server_->getConnectedCount() > 0 && millis() - lastActivityMs_ > kIdleDisconnectMs) {
    Serial.println("[ble] idle config connection, disconnecting");
    for (auto &peer : server_->getPeerDevices(false)) server_->disconnect(peer.first);
    lastActivityMs_ = millis();
  }
}

bool BeaconRadio::pollRequest(Request &out) {
  return requests_ != nullptr && xQueueReceive(requests_, &out, 0) == pdTRUE;
}

void BeaconRadio::setConfigJson(const String &json) {
  if (configChar_ != nullptr) configChar_->setValue(json);
}

void BeaconRadio::publishStatus(const String &json) {
  if (statusChar_ == nullptr) return;
  statusChar_->setValue(json);
  if (connectedCount() > 0) statusChar_->notify();
}

uint32_t BeaconRadio::connectedCount() const {
  return server_ == nullptr ? 0 : server_->getConnectedCount();
}

void BeaconRadio::onConnectEvt() {
  lastActivityMs_ = millis();
  restartAdv_ = true;  // keep beaconing for other phones while one is configuring
}

void BeaconRadio::onDisconnectEvt() { restartAdv_ = true; }

void BeaconRadio::onWriteEvt(const String &value) {
  lastActivityMs_ = millis();
  // Runs in the BLE task: copy and hand off; all parsing happens in the main loop.
  static Request req;  // static: too large for the BLE task stack; only this task writes it
  if (value.length() > kMaxRequestLen) {
    req.len = 0;  // signals "too long" to the main loop
  } else {
    req.len = static_cast<uint16_t>(value.length());
    memcpy(req.data, value.c_str(), req.len);
  }
  req.data[req.len] = '\0';
  if (requests_ == nullptr || xQueueSend(requests_, &req, 0) != pdTRUE) {
    Serial.println("[ble] request dropped (busy)");
  }
}

}  // namespace cnav
