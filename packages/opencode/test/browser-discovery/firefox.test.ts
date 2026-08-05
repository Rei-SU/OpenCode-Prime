import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"

import { findFirefoxAuthCookie, firefoxProfiles } from "../../src/browser-discovery/providers/firefox"

function makeFirefoxRoot(root: string): void {
  const profile = path.join(root, "Profiles", "test.default")
  mkdirSync(profile, { recursive: true })
  const db = new Database(path.join(profile, "cookies.sqlite"))
  db.run(`CREATE TABLE moz_cookies (id INTEGER, originAttributes TEXT, name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER)`)
  db.run(
    `INSERT INTO moz_cookies (id, originAttributes, name, value, host, path, expiry, lastAccessed) VALUES (1, '', 'auth', ?, 'opencode.ai', '/', 0, ?)`,
    ["Fe26.2**firefox-value", 1786000000000000],
  )
  db.close()
}

test("firefoxProfiles lists profiles with a cookie store", () => {
  const root = path.join(process.env.TMPDIR ?? "/tmp", `oc-ff-test-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  try {
    makeFirefoxRoot(root)
    const profiles = firefoxProfiles(root)
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toContain("test.default")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("findFirefoxAuthCookie reads a plaintext auth cookie", async () => {
  const root = path.join(process.env.TMPDIR ?? "/tmp", `oc-ff-test-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  try {
    makeFirefoxRoot(root)
    const found = await findFirefoxAuthCookie(root)
    expect(found).toBeDefined()
    expect(found?.browser).toBe("firefox")
    expect(found?.cookie).toBe("auth=Fe26.2**firefox-value")
    expect(found?.modified).toBeGreaterThan(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("findFirefoxAuthCookie returns undefined for an empty root", async () => {
  const root = path.join(process.env.TMPDIR ?? "/tmp", `oc-ff-test-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  try {
    expect(await findFirefoxAuthCookie(root)).toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
