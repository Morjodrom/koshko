/** Limits are intentionally lower than transport defaults to bound loopback memory use. */
export const BRIDGE_PROTOCOL = 'koshko-bridge';
export const BRIDGE_VERSION = 1;

export const MAX_AUTH_TOKEN_CODE_POINTS = 256;
export const MIN_AUTH_TOKEN_CODE_POINTS = 32;
export const MAX_BRIDGE_ID_CODE_POINTS = 128;
export const MAX_SESSION_URL_CODE_POINTS = 8_192;
export const MAX_SESSION_TITLE_CODE_POINTS = 512;
export const MAX_CAPTURE_BATCH_ENTRIES = 100;
export const MAX_AI_LOG_ENTRIES = 100;
export const MAX_BRIDGE_ENTRY_BYTES = 64 * 1024;
export const MAX_BRIDGE_MESSAGE_BYTES = 512 * 1024;
export const MAX_STATE_SNAPSHOT_BYTES = 256 * 1024;
export const MAX_GENERIC_POST_MESSAGE_BYTES = 32 * 1024;
export const MAX_GENERIC_POST_MESSAGE_TYPE_CODE_POINTS = 128;
export const MAX_AI_LOG_TEXT_CODE_POINTS = MAX_BRIDGE_MESSAGE_BYTES;
export const MAX_JSON_DEPTH = 8;
export const MAX_JSON_ARRAY_LENGTH = 500;
export const MAX_JSON_OBJECT_PROPERTIES = 200;
