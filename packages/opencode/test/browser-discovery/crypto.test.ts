import { expect, test } from "bun:test"
import { createCipheriv, randomBytes } from "node:crypto"

import { decryptChromiumCookie } from "../../src/browser-discovery/crypto"

const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8")

function encryptV10(plaintext: Buffer): Buffer {
  const iv = randomBytes(16)
  const cipher = createCipheriv("aes-128-cbc", KEY.subarray(0, 16), iv)
  return Buffer.concat([Buffer.from("v10"), iv, cipher.update(plaintext), cipher.final()])
}

function encryptV11(plaintext: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", KEY, iv)
  return Buffer.concat([Buffer.from("v11"), iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

test("decrypts a v10 cookie", () => {
  const value = Buffer.from("Fe26.2**opencode-session-value", "utf8")
  expect(decryptChromiumCookie(KEY, encryptV10(value))).toBe(value.toString("utf8"))
})

test("decrypts a v11 cookie", () => {
  const value = Buffer.from("Fe26.2**opencode-session-value", "utf8")
  expect(decryptChromiumCookie(KEY, encryptV11(value))).toBe(value.toString("utf8"))
})

test("passes through plaintext values", () => {
  expect(decryptChromiumCookie(KEY, Buffer.from("plain-value"))).toBe("plain-value")
})

test("rejects v20 app-bound cookies", () => {
  expect(() => decryptChromiumCookie(KEY, Buffer.concat([Buffer.from("v20"), randomBytes(32)]))).toThrow(
    /v20 app-bound/,
  )
})
