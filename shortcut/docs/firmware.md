# ESP32 beacon firmware

`firmware/esp32_beacon/` is a PlatformIO Arduino C++ project with `esp32s3`, `esp32`, and `esp32-wrover-e` environments. It supports NimBLE on S3 and Bluedroid on classic ESP32.

- `main.cpp`: startup, serial command loop, diagnostics, and request dispatch.
- `beacon_config.*`: validated configuration model and NVS persistence.
- `config_service.*`: atomic JSON request validation/application for BLE and serial.
- `beacon_radio.*`: advertising, GATT characteristics, TX power, connections, and request queue.
- `protocol.h`: UUIDs, name prefix, manufacturer payload, and request limits mirrored by `src/config.ts`.

Each board runs target-specific firmware from the same source. Id and calibration are runtime NVS values, never per-board constants. The scan response broadcasts measured power/path loss/revision; the GATT service permits app-side configuration.

See the project [README](../README.md) for flashing commands and the complete calibration protocol.
