import { Database } from "bun:sqlite"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { chromiumKey, decryptChromiumCookie } from "../crypto"
import { browserRoot, isProfileDirectory } from "../platform"
import type { BrowserCookie, BrowserId } from "../schema"

// Chrome's cookie timestamps are microseconds since 1601-01-01 (WebKit epoch).
const WEBKIT_EPOCH_OFFSET_MS = 11644473600000

function webkitToEpochMs(us: number): number {
  return Math.floor(us / 10) - WEBKIT_EPOCH_OFFSET_MS
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
}

export function chromiumProfiles(browser: BrowserId, root = browserRoot(browser)): string[] {
  if (!root || !existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isProfileDirectory(entry.name))
      .map((entry) => path.join(root, entry.name))
  } catch {
    return []
  }
}

/**
 * Search every profile of a Chromium-family browser for the opencode.ai `auth`
 * cookie, returning the most recently modified one. The DPAPI/keychain key is
 * unlocked once per browser. Profiles that are locked, corrupt, or use v20
 * app-bound cookies are skipped individually.
 */
export async function findChromiumAuthCookie(
  browser: BrowserId,
  root = browserRoot(browser),
): Promise<BrowserCookie | undefined> {
  const profiles = chromiumProfiles(browser, root)
  if (profiles.length === 0 || !root) return undefined
  const localStateFile = path.join(root, "Local State")
  if (!existsSync(localStateFile)) return undefined
  let key: Buffer
  try {
    key = await chromiumKey(readJson(localStateFile))
  } catch {
    return undefined // keychain/DPAPI unavailable for this browser
  }
  let best: BrowserCookie | undefined
  for (const profile of profiles) {
    try {
      const cookie = readProfileCookie(browser, profile, key)
      if (cookie && (!best || cookie.modified > best.modified)) best = cookie
    } catch {
      // locked / corrupt DB, or undecryptable value — continue
    }
  }
  return best
}

export function readProfileCookie(browser: BrowserId, profile: string, key: Buffer): BrowserCookie | undefined {
  const dbFile = path.join(profile, "Network", "Cookies")
  if (!existsSync(dbFile)) return undefined
  const db = new Database(dbFile, { readonly: true })
  try {
    const rows = db
      .query(`SELECT host_key, name, encrypted_value, last_access_utc FROM cookies WHERE name = 'auth'`)
      .all() as Array<{ host_key: string; name: string; encrypted_value: Uint8Array; last_access_utc: number }>
    for (const row of rows) {
      const host = row.host_key
      if (host !== "opencode.ai" && host !== ".opencode.ai") continue
      const value = decryptChromiumCookie(key, Buffer.from(row.encrypted_value))
      if (!value) continue
      return {
        browser,
        profile: path.basename(profile),
        cookie: `auth=${value}`,
        modified: webkitToEpochMs(row.last_access_utc),
      }
    }
    return undefined
  } finally {
    db.close()
  }
}
