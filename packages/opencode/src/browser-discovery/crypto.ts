import { createDecipheriv, pbkdf2Sync } from "node:crypto"

import { dpapiUnprotect, isLinux, isMac, isWindows, keychainPassword } from "./platform"

export const CHROMIUM_MAC_SALT = "saltysalt"
export const CHROMIUM_MAC_ITERATIONS = 1003

/**
 * Derive the Chromium cookie encryption key for the current platform.
 *
 * - Windows: `os_crypt.encrypted_key` is a DPAPI blob (prefixed `DPAPI`);
 *   unprotect it through the OS to get the 32-byte AES key.
 * - Linux: `os_crypt.encrypted_key` is the base64 raw key (optionally with a
 *   `v10`/`v11` prefix) — no further OS call required.
 * - macOS: the key is a Keychain item ("Chrome Safe Storage"); the AES-128 key
 *   is PBKDF2(password, "saltysalt", 1003).
 */
export async function chromiumKey(localState: Record<string, unknown>): Promise<Buffer> {
  if (isMac) {
    const password = await keychainPassword("Chrome Safe Storage", "Chrome")
    return pbkdf2Sync(password, CHROMIUM_MAC_SALT, CHROMIUM_MAC_ITERATIONS, 16, "sha1")
  }
  const osCrypt = localState["os_crypt"]
  if (typeof osCrypt !== "object" || osCrypt === null) throw new Error("Local State is missing os_crypt")
  const encrypted = (osCrypt as Record<string, unknown>)["encrypted_key"]
  if (typeof encrypted !== "string") throw new Error("Local State is missing os_crypt.encrypted_key")
  const encoded = Buffer.from(encrypted, "base64")
  if (isWindows) {
    const prefix = encoded.subarray(0, 5).toString("utf8")
    if (prefix !== "DPAPI") throw new Error(`unexpected Windows key prefix ${prefix}`)
    return dpapiUnprotect(encoded.subarray(5))
  }
  if (isLinux) {
    const version = encoded.subarray(0, 3).toString("utf8")
    if (version === "v10" || version === "v11") return encoded.subarray(3)
    return encoded
  }
  throw new Error(`unsupported platform for Chromium cookie decryption: ${process.platform}`)
}

/**
 * Decrypt a Chromium cookie value. Supports v10 (AES-128-CBC), v11
 * (AES-256-GCM), and plaintext cookies. v20 (app-bound) cookies are refused
 * with a descriptive error — they cannot be decrypted through the OS APIs.
 */
export function decryptChromiumCookie(key: Buffer, encrypted: Buffer): string {
  if (encrypted.length === 0) throw new Error("empty encrypted cookie value")
  const version = encrypted.toString("utf8", 0, 3)
  if (version === "v10" || version === "v11") {
    const payload = encrypted.subarray(3)
    if (version === "v11") {
      if (payload.length < 12 + 16) throw new Error("short v11 cookie payload")
      const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12))
      decipher.setAuthTag(payload.subarray(payload.length - 16))
      return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]).toString(
        "utf8",
      )
    }
    const aesKey = key.length >= 32 ? key.subarray(0, 16) : key
    const decipher = createDecipheriv("aes-128-cbc", aesKey, payload.subarray(0, 16))
    return Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]).toString("utf8")
  }
  if (version === "v20") throw new Error("v20 app-bound cookies are not decryptable via the OS")
  return encrypted.toString("utf8")
}
