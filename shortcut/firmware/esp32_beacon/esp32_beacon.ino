/*
 * Shortcut BLE beacon (ESP32, Arduino framework)
 *
 * Flash the SAME sketch to every board; only change BEACON_ID per board
 * (B1, B2, B3 ...). The id must match an entry in src/data/building.json -> "beacons".
 *
 * The iOS app filters on SERVICE_UUID and reads the id from the advertised
 * local name "CNAV-<BEACON_ID>". The name goes in the scan response so the
 * 128-bit UUID + flags fit in the primary advertising packet.
 *
 * Arduino IDE setup:
 *   - Boards Manager: install "esp32 by Espressif Systems"
 *   - Board: your ESP32 variant (e.g. "ESP32 Dev Module")
 *   - No extra libraries needed (BLEDevice.h ships with the ESP32 core)
 *   - Keep TX power identical on all boards so RSSI is comparable.
 */
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEAdvertising.h>

// ---- CHANGE THIS PER BOARD -------------------------------------------------
#define BEACON_ID "B1"
// ---------------------------------------------------------------------------

// Must match BEACON_SERVICE_UUID in src/config.ts
#define SERVICE_UUID "7a1c0001-5f3e-4b8a-9d2e-0c4a5b6d7e8f"

void setup() {
  Serial.begin(115200);
  BLEDevice::init("CNAV-" BEACON_ID);
  BLEDevice::setPower(ESP_PWR_LVL_P3); // same on every board (range: N12 .. P9)

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);          // puts the device name in the scan response
  adv->setMinInterval(0x20);           // 20 ms units of 0.625 ms -> fast updates for smooth RSSI
  adv->setMaxInterval(0x40);           // 40 ms
  BLEDevice::startAdvertising();

  Serial.println("Shortcut beacon advertising as CNAV-" BEACON_ID);
}

void loop() {
  delay(10000); // advertising runs in the BLE stack; nothing to do here
}
