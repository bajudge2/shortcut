// Shortcut BLE beacon firmware.
//
// One binary for every board. Identity (beacon id) and calibration (TX power,
// advertising interval, 1 m RSSI, path-loss exponent) are stored in NVS and set
// at runtime, either by the iOS app over BLE or by typing JSON into the serial monitor:
//
//   {"id":"B1"}
//   {"txPower":3,"measuredPower":-61,"pathLoss":2.2}
//   {"cmd":"get"}   {"cmd":"reboot"}   {"cmd":"factory_reset"}
//
// See README "Flash the ESP32 beacons" for the full protocol.
#include <Arduino.h>

#include "beacon_config.h"
#include "beacon_radio.h"
#include "config_service.h"
#include "protocol.h"

namespace {

cnav::ConfigStore store;
cnav::BeaconConfig config;
cnav::BeaconRadio radio;
cnav::ConfigService service(store, config);

constexpr uint32_t kHeartbeatMs = 30000;
uint32_t lastHeartbeat = 0;

char serialBuf[cnav::kMaxRequestLen + 1];
size_t serialLen = 0;
bool serialOverflow = false;

void printConfig() {
  Serial.print("[cfg] ");
  Serial.println(service.configJson());
}

void printHelp() {
  Serial.println("Send one JSON object per line, e.g.:");
  Serial.println("  {\"id\":\"B1\"}");
  Serial.println("  {\"txPower\":3,\"advInterval\":40,\"measuredPower\":-59,\"pathLoss\":2.0}");
  Serial.println("  {\"pin\":\"1234\"}   (BLE writes then need \"auth\":\"1234\"; \"\" clears)");
  Serial.println("  {\"cmd\":\"get\"} | {\"cmd\":\"reboot\"} | {\"cmd\":\"factory_reset\"}");
}

void process(const char *json, size_t len, cnav::Source src) {
  const char *tag = src == cnav::Source::Ble ? "[ble]" : "[serial]";
  cnav::RequestResult res = service.handle(json, len, src);

  if (res.radioChanged && !radio.apply(config)) {
    Serial.println("[ble] ERROR: saved config but could not reconfigure radio; reboot to retry");
  }
  radio.setConfigJson(service.configJson());
  radio.publishStatus(res.status);

  Serial.printf("%s -> %s\n", tag, res.status.c_str());
  if (res.radioChanged || src == cnav::Source::Serial) printConfig();

  if (res.reboot) {
    Serial.println("[sys] rebooting");
    Serial.flush();
    delay(300);  // let the status notification go out
    ESP.restart();
  }
}

void pollSerial() {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n') {
      if (serialOverflow) {
        process("", 0, cnav::Source::Serial);  // reports "too long"
      } else if (serialLen > 0) {
        serialBuf[serialLen] = '\0';
        if (strcmp(serialBuf, "help") == 0 || strcmp(serialBuf, "?") == 0) printHelp();
        else process(serialBuf, serialLen, cnav::Source::Serial);
      }
      serialLen = 0;
      serialOverflow = false;
    } else if (serialLen < cnav::kMaxRequestLen) {
      serialBuf[serialLen++] = c;
    } else {
      serialOverflow = true;
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.printf("[sys] chip=%s rev=%u cores=%u flash=%luMB psram=%s (%luKB) heap=%luKB\n", ESP.getChipModel(),
                ESP.getChipRevision(), ESP.getChipCores(), static_cast<unsigned long>(ESP.getFlashChipSize() / (1024 * 1024)),
                psramFound() ? "yes" : "no", static_cast<unsigned long>(ESP.getPsramSize() / 1024),
                static_cast<unsigned long>(ESP.getFreeHeap() / 1024));
  Serial.println("[sys] loading config");
  bool stored = store.load(config);
  Serial.printf("[sys] config %s; starting BLE\n", stored ? "loaded" : "using defaults");
  config.txPowerDbm = cnav::BeaconRadio::snapTxPower(config.txPowerDbm);
  bool radioReady = radio.begin(config);
  radio.setConfigJson(service.configJson());

  Serial.printf("\nShortcut beacon fw %s on %s\n", cnav::kFirmwareVersion, ESP.getChipModel());
  if (radioReady) {
    Serial.printf("Advertising as %s%s (%s config)\n", cnav::kNamePrefix, config.id, stored ? "stored" : "default");
  } else {
    Serial.println("FATAL: BLE beacon did not start; inspect errors above and reboot");
  }
  printConfig();
  Serial.println("Type 'help' for serial commands.");
}

void loop() {
  radio.loop();

  cnav::BeaconRadio::Request req;
  while (radio.pollRequest(req)) process(req.data, req.len, cnav::Source::Ble);

  pollSerial();

  if (millis() - lastHeartbeat > kHeartbeatMs) {
    lastHeartbeat = millis();
    Serial.printf("[sys] %s%s up %lus, %lu phone(s) connected, tx %d dBm\n", cnav::kNamePrefix, config.id,
                  static_cast<unsigned long>(millis() / 1000), static_cast<unsigned long>(radio.connectedCount()),
                  radio.currentTxPowerDbm());
  }
  delay(10);
}
