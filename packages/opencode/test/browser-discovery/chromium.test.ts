import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createCipheriv, randomBytes } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { decryptChromiumCookie } from "../../src/browser-discovery/crypto"
import { readProfileCookie } from "../../src/browser-discovery/providers/chromium"
import { isProfileDirectory } from "../../src/browser-discovery/platform"

const KEY = Buffer.from("abcdef0123456789abcdef0123456789", "utf8")

function encryptV10(plaintext: string): Buffer {
  const iv = randomBytes(16)
  const cipher = createCipheriv("aes-128-cbc", KEY.subarray(0, 16), iv)
  return Buffer.concat([Buffer.from("v10"), iv, cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()])
}

function makeProfile(root: string): string {
  const profile = path.join(root, "Default", "Network")
  mkdirSync(profile, { recursive: true })
  const db = new Database(path.join(profile, "Cookies"))
  db.run(
    `CREATE TABLE cookies (host_key TEXT NOT NULL, name TEXT NOT NULL, encrypted_value BLOB, last_access_utc INTEGER)`,
  )
  const cookie = encryptV10("Fe26.2**test-value")
  db.run(`INSERT INTO cookies (host_key, name, encrypted_value, last_access_utc) VALUES (?, 'auth', ?, ?)`, [
    "opencode.ai",
    cookie,
    13310000000000000, // some WebKit microsecond timestamp
  ])
  db.close()
  return path.dirname(profile)
}

test("isProfileDirectory filters non-profile directories", () => {
  expect(isProfileDirectory("Default")).toBe(true)
  expect(isProfileDirectory("Profile 1")).toBe(true)
  expect(isProfileDirectory("System Profile")).toBe(false)
  expect(isProfileDirectory("Guest Profile")).toBe(false)
  expect(isProfileDirectory(".hidden")).toBe(false)
  expect(isProfileDirectory("ShaderCache")).toBe(false)
})

test("readProfileCookie reads and decrypts the opencode.ai auth cookie", () => {
  const root = path.join(process.env.TMPDIR ?? "/tmp", `oc-disc-test-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  try {
    const profile = makeProfile(root)
    const found = readProfileCookie("chrome", profile, KEY)
    expect(found).toBeDefined()
    expect(found?.browser).toBe("chrome")
    expect(found?.cookie).toBe("auth=Fe26.2**test-value")
    expect(found?.modified).toBeGreaterThan(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("decryptChromiumCookie works on the fixture", () => {
  expect(decryptChromiumCookie(KEY, encryptV10("hello"))).toBe("hello")
})
