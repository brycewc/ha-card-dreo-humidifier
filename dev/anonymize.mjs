export const PLACEHOLDER_SERIAL = "0000000000000000000-0000000000000000:001:0000000000b";
export const PLACEHOLDER_DEVICE_ID = "0123456789abcdef0123456789abcdef";
const PLACEHOLDER_IP = "192.0.2.10";

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces everything in a snapshot that identifies the device or its home before it is committed.
export function anonymize(data, { serial, deviceId }) {
  let text = JSON.stringify(data);
  for (const [from, to] of [
    [serial, PLACEHOLDER_SERIAL],
    [deviceId, PLACEHOLDER_DEVICE_ID],
  ]) {
    if (from) text = text.replace(new RegExp(escape(from), "gi"), to);
  }
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, PLACEHOLDER_IP);
  return JSON.parse(text);
}
