#pragma once
// Wire protocol shared with the iOS app. Keep in sync with src/config.ts in the app.
#include <stddef.h>
#include <stdint.h>

namespace cnav {

constexpr const char *kFirmwareVersion = "1.0.0";

// Advertised in every packet; the app's scan filters on it. Also the GATT config service.
constexpr const char *kServiceUuid = "7a1c0001-5f3e-4b8a-9d2e-0c4a5b6d7e8f";
// READ: current config as JSON. WRITE: a JSON request (see README).
constexpr const char *kConfigCharUuid = "7a1c0002-5f3e-4b8a-9d2e-0c4a5b6d7e8f";
// READ / NOTIFY: JSON result of the last request, e.g. {"ok":true,"rev":4}.
constexpr const char *kStatusCharUuid = "7a1c0003-5f3e-4b8a-9d2e-0c4a5b6d7e8f";

// Advertised local name is kNamePrefix + beacon id, e.g. "CNAV-B1".
constexpr const char *kNamePrefix = "CNAV-";

// Manufacturer data in the scan response (lets every phone read the calibration
// without connecting):
//   [0..1] company id 0xFFFF (little endian; SIG "reserved for testing")
//   [2]    format version (kMfgFormatVersion)
//   [3]    measuredPower: int8, expected RSSI at 1 m in dBm
//   [4]    pathLoss x10:  uint8, path-loss exponent * 10 (20 = 2.0)
//   [5]    config revision, low byte (changes on every saved calibration)
constexpr uint16_t kMfgCompanyId = 0xFFFF;
constexpr uint8_t kMfgFormatVersion = 1;

// Largest JSON request accepted over serial. BLE writes are further limited by the
// negotiated ATT MTU (typically ~180 bytes on iOS), so apps should send one small request per write.
constexpr size_t kMaxRequestLen = 512;

}  // namespace cnav
