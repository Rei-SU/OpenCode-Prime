import { Database } from "bun:sqlite"
import { createDecipheriv, createHash } from "node:crypto"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { browserRoot } from "../platform"
import type { BrowserCookie } from "../schema"

function microToEpochMs(us: number): number {
  return Math.floor(us / 1000)
}

export function firefoxProfiles(root = browserRoot("firefox")): string[] {
  if (!root || !existsSync(root)) return []
  const profilesDir = path.join(root, "Profiles")
  if (!existsSync(profilesDir)) return []
  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(profilesDir, entry.name, "cookies.sqlite")))
      .map((entry) => path.join(profilesDir, entry.name))
  } catch {
    return []
  }
}

export async function findFirefoxAuthCookie(root = browserRoot("firefox")): Promise<BrowserCookie | undefined> {
  let best: BrowserCookie | undefined
  for (const profile of firefoxProfiles(root)) {
    try {
      const cookie = await readProfile(profile)
      if (cookie && (!best || cookie.modified > best.modified)) best = cookie
    } catch {
      // locked / corrupt profile — continue scanning
    }
  }
  return best
}

function columns(db: Database): Set<string> {
  return new Set(db.query(`PRAGMA table_info(moz_cookies)`).all().map((row) => (row as { name: string }).name))
}

async function readProfile(profile: string): Promise<BrowserCookie | undefined> {
  const db = new Database(path.join(profile, "cookies.sqlite"), { readonly: true })
  try {
    const encrypted = columns(db).has("encrypted_value")
    const rows = db
      .query(
        encrypted
          ? `SELECT host, name, value, encrypted_value, lastAccessed FROM moz_cookies WHERE name = 'auth'`
          : `SELECT host, name, value, lastAccessed FROM moz_cookies WHERE name = 'auth'`,
      )
      .all() as Array<Record<string, unknown>>
    const sdrKey = encrypted ? readSdrKey(profile) : undefined
    try {
      for (const row of rows) {
        const host = row["host"]
        if (host !== "opencode.ai" && host !== ".opencode.ai") continue
        const value = encrypted
          ? decryptFirefoxValue(row["encrypted_value"] as Uint8Array, sdrKey)
          : String(row["value"] ?? "")
        if (!value) continue
        return {
          browser: "firefox" as const,
          profile: path.basename(profile),
          cookie: `auth=${value}`,
          modified: microToEpochMs(Number(row["lastAccessed"] ?? 0)),
        }
      }
      return undefined
    } finally {
      // The profile's SDR key is sensitive: zero it once discovery is done.
      sdrKey?.fill(0)
    }
  } finally {
    db.close()
  }
}

/**
 * Decrypt a Firefox cookie value with the profile's SDR key. Firefox stores
 * values in `encrypted_value` (NSS symmetric-wrap); most profiles have an
 * empty master password. Returns "" when decryption is not possible so the
 * profile is skipped gracefully (e.g. a master password is set).
 */
export function decryptFirefoxValue(encrypted: Uint8Array, sdrKey: Buffer | undefined): string {
  if (!encrypted || encrypted.length === 0 || !sdrKey) return ""
  try {
    // layout: 4-byte big-endian length prefix, then IV + AES-CBC ciphertext
    const payload = encrypted.subarray(4)
    if (payload.length < 16) return ""
    const decipher = createDecipheriv("aes-256-cbc", sdrKey, payload.subarray(0, 16))
    return Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]).toString("utf8")
  } catch {
    return ""
  }
}

// Read the SDR key from a profile's key4.db using the NSS symmetric-wrap
// derivation with an empty master password.
function readSdrKey(profile: string): Buffer | undefined {
  const keyDb = path.join(profile, "key4.db")
  if (!existsSync(keyDb)) return undefined
  try {
    const db = new Database(keyDb, { readonly: true })
    try {
      const meta = db.query(`SELECT item1 FROM metadata LIMIT 1`).get() as { item1: Uint8Array } | undefined
      const privateRow = db.query(`SELECT a11 FROM nssPrivate LIMIT 1`).get() as { a11: Uint8Array } | undefined
      if (!meta?.item1 || !privateRow?.a11) return undefined
      return unwrapNss(privateRow.a11, meta.item1)
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

function sha1(data: Uint8Array): Buffer {
  return createHash("sha1").update(data).digest()
}

function unwrapNss(a11: Uint8Array, globalSalt: Uint8Array): Buffer | undefined {
  const password = Buffer.alloc(0) // empty master password
  const k1 = sha1(Buffer.concat([Buffer.from(globalSalt), password]))
  const k2 = sha1(k1)
  const hp = sha1(k2)
  // a11: optional version byte, then a 4-byte big-endian length and the
  // AES-CBC ciphertext (IV prefix) wrapped with the HP key.
  let offset = 0
  if (a11.length > 0 && a11[0] === 0x01) offset = 1
  const length = readUint32BE(a11, offset)
  const end = Math.min(offset + 4 + length, a11.length)
  const region = a11.subarray(offset + 4, end)
  if (region.length < 16) return undefined
  try {
    const decipher = createDecipheriv("aes-256-cbc", hp, region.subarray(0, 16))
    return Buffer.concat([decipher.update(region.subarray(16)), decipher.final()])
  } catch {
    return undefined
  }
}

function readUint32BE(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) return 0
  return ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0
}
