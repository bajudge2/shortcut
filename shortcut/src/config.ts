/** Must match firmware/esp32_beacon/src/protocol.h */
export const BEACON_SERVICE_UUID = '7a1c0001-5f3e-4b8a-9d2e-0c4a5b6d7e8f';
export const BEACON_NAME_PREFIX = 'CNAV-';

/** GATT calibration service (same UUID as BEACON_SERVICE_UUID). */
/** READ -> current config JSON; WRITE <- JSON request, e.g. {"id":"B1","measuredPower":-61}. */
export const BEACON_CONFIG_CHAR_UUID = '7a1c0002-5f3e-4b8a-9d2e-0c4a5b6d7e8f';
/** READ / NOTIFY -> result of the last request, e.g. {"ok":true,"cmd":"set","rev":4,"changed":true}. */
export const BEACON_STATUS_CHAR_UUID = '7a1c0003-5f3e-4b8a-9d2e-0c4a5b6d7e8f';

/**
 * Manufacturer data in the scan response, keyed by company id 0xFFFF (65535):
 * [0] format version, [1] measuredPower int8 (RSSI @ 1 m), [2] pathLoss * 10 uint8, [3] config rev (low byte).
 */
export const BEACON_MFG_COMPANY_ID = 0xffff;

/** Meters the dot moves per detected step. Raised from 0.7, then 0.8: on site the dot still lagged slightly behind walking pace. */
export const STEP_LENGTH_M = 0.9;

/** Beacons silent this long while scanning => "Bluetooth signal lost". */
export const SIGNAL_QUIET_THRESHOLD_MS = 15_000;
/** Arrival card stays up through position drift shorter than this. */
export const ARRIVAL_DWELL_MS = 3_000;
