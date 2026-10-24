#pragma once
// BLE side of the beacon: advertising (what phones scan) + a small GATT service
// the app connects to for calibration. Works on both BLE stacks the Arduino core
// ships (NimBLE on ESP32-S3, Bluedroid on classic ESP32).
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include "beacon_config.h"
#include "protocol.h"

class BLEServer;
class BLECharacteristic;

namespace cnav {

class BeaconRadio {
 public:
  // A request written by a phone, copied out of the BLE task for the main loop.
  struct Request {
    uint16_t len;
    char data[kMaxRequestLen + 1];
  };

  // Returns false if the BLE stack, GATT service, or advertising could not start.
  bool begin(const BeaconConfig &cfg);
  // Re-applies name / TX power / interval / manufacturer data. Safe to call any time.
  bool apply(const BeaconConfig &cfg);
  bool isReady() const { return ready_; }
  // Main-loop housekeeping: restarts advertising after connects/disconnects and
  // drops config connections that have been idle too long.
  void loop();

  // Next pending request from BLE, if any (non-blocking).
  bool pollRequest(Request &out);
  void setConfigJson(const String &json);
  void publishStatus(const String &json);

  uint32_t connectedCount() const;
  // TX power level actually applied (dBm), read back from the controller.
  int currentTxPowerDbm() const;

  // Nearest TX power level this chip supports, in dBm.
  static int8_t snapTxPower(int dbm);

  // Called from BLE callbacks (BLE task context).
  void onConnectEvt();
  void onDisconnectEvt();
  void onWriteEvt(const String &value);

 private:
  bool buildAdvertising(const BeaconConfig &cfg);
  bool startAdvertising();
  bool setTxPower(int8_t dbm);
  void setDeviceName(const String &name);

  BLEServer *server_ = nullptr;
  BLECharacteristic *configChar_ = nullptr;
  BLECharacteristic *statusChar_ = nullptr;
  QueueHandle_t requests_ = nullptr;
  bool ready_ = false;
  bool advertising_ = false;

  volatile bool restartAdv_ = false;
  volatile uint32_t lastActivityMs_ = 0;
};

}  // namespace cnav
