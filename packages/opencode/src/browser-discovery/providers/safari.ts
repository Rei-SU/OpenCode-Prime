import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { browserRoot } from "../platform"
import type { BrowserCookie } from "../schema"

// Safari stores cookies in `Cookies.binarycookies` (a bespoke binary format:
// 'cook' magic, page table, per-record offset fields and null-terminated
// UTF-8 strings). Values are read directly from the string area.
export function findSafariAuthCookie(): BrowserCookie | undefined {
  const root = browserRoot("safari")
  if (!root) return undefined
  const file = path.join(root, "Cookies.binarycookies")
  if (!existsSync(file)) return undefined
  try {
    const data = readFileSync(file)
    return parseBinaryCookies(data)
  } catch {
    return undefined
  }
}

function parseBinaryCookies(data: Buffer): BrowserCookie | undefined {
  if (data.length < 8 || data.toString("utf8", 0, 4) !== "cook") return undefined
  const pageCount = data.readUInt32BE(4)
  let best: BrowserCookie | undefined
  for (let page = 0; page < pageCount; page++) {
    const pageOffset = data.readUInt32BE(8 + page * 4)
    if (pageOffset + 4 > data.length) continue
    const cookieCount = data.readUInt32BE(pageOffset)
    const headerSize = data.readUInt32BE(pageOffset + 4)
    if (headerSize < 8) continue
    for (let i = 0; i < cookieCount; i++) {
      const cookieOffset = data.readUInt32BE(pageOffset + 8 + i * 4)
      const record = parseCookieRecord(data, pageOffset + cookieOffset)
      if (record && (record.host === "opencode.ai" || record.host === ".opencode.ai") && record.name === "auth") {
        if (record.value && (!best || record.modified > best.modified)) {
          best = {
            browser: "safari",
            profile: "default",
            cookie: `auth=${record.value}`,
            modified: record.modified,
          }
        }
      }
    }
  }
  return best
}

type CookieRecord = { host: string; name: string; path: string; value: string; modified: number }

function parseCookieRecord(data: Buffer, offset: number): CookieRecord | undefined {
  if (offset + 0x40 > data.length) return undefined
  const size = data.readUInt32BE(offset)
  if (size < 0x40 || offset + size > data.length) return undefined
  const domainOffset = data.readUInt32BE(offset + 0x20)
  const nameOffset = data.readUInt32BE(offset + 0x24)
  const pathOffset = data.readUInt32BE(offset + 0x28)
  const valueOffset = data.readUInt32BE(offset + 0x2c)
  const host = readString(data, offset + domainOffset, offset + size)
  const name = readString(data, offset + nameOffset, offset + size)
  const value = readString(data, offset + valueOffset, offset + size)
  // creation time is seconds since 2001-01-01T00:00:00Z
  const created = data.readDoubleBE(offset + 0x10)
  if (!host || !name) return undefined
  return { host, name, path: readString(data, offset + pathOffset, offset + size), value, modified: created * 1000 + 978307200000 }
}

function readString(data: Buffer, start: number, end: number): string {
  if (start < 0 || start >= end || start >= data.length) return ""
  const nul = data.indexOf(0, start)
  const stop = nul === -1 || nul > end ? end : nul
  return data.toString("utf8", start, stop)
}
