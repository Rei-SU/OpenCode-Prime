import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"

import type { BrowserId } from "./schema"

const execFileAsync = promisify(execFile)

export type Platform = "win32" | "darwin" | "linux"

export const platform: Platform = os.platform() as Platform

export const isWindows = platform === "win32"
export const isMac = platform === "darwin"
export const isLinux = platform === "linux"

const home = os.homedir()
const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")

// Per-OS data roots for each browser. Providers enumerate profiles under the
// root themselves; an empty root means the browser has no default location on
// that platform (and is treated as not installed).
const CHROMIUM_ROOTS: Record<Platform, Record<BrowserId, { root: string }>> = {
  win32: {
    chrome: { root: path.join(localAppData, "Google", "Chrome", "User Data") },
    chromium: { root: path.join(localAppData, "Chromium", "User Data") },
    edge: { root: path.join(localAppData, "Microsoft", "Edge", "User Data") },
    brave: { root: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data") },
    arc: { root: path.join(appData, "Arc", "User Data") },
    firefox: { root: path.join(appData, "Mozilla", "Firefox") },
    safari: { root: "" },
  },
  darwin: {
    chrome: { root: path.join(home, "Library", "Application Support", "Google", "Chrome") },
    chromium: { root: path.join(home, "Library", "Application Support", "Chromium") },
    edge: { root: path.join(home, "Library", "Application Support", "Microsoft Edge") },
    brave: { root: path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser") },
    arc: { root: path.join(home, "Library", "Application Support", "Arc", "User Data") },
    firefox: { root: path.join(home, "Library", "Application Support", "Firefox") },
    safari: { root: path.join(home, "Library", "Cookies") },
  },
  linux: {
    chrome: { root: path.join(home, ".config", "google-chrome") },
    chromium: { root: path.join(home, ".config", "chromium") },
    edge: { root: path.join(home, ".config", "microsoft-edge") },
    brave: { root: path.join(home, ".config", "BraveSoftware", "Brave-Browser") },
    arc: { root: "" },
    firefox: { root: path.join(home, ".mozilla", "firefox") },
    safari: { root: "" },
  },
}

export function browserRoot(browser: BrowserId): string {
  return CHROMIUM_ROOTS[platform][browser].root
}

export function isProfileDirectory(name: string): boolean {
  if (name.startsWith(".")) return false
  if (/^(System Profile|Guest Profile|Default Profile|Profile 0)$/.test(name)) return false
  return !["Local State", "Crashpad", "ShaderCache", "GrShaderCache", "GPUCache"].includes(name)
}

/**
 * Unprotect a DPAPI blob using the OS `CryptUnprotectData` API (Windows).
 * Runs a tiny C# helper through PowerShell so the call goes through the
 * platform's official protection API rather than a hand-rolled scheme.
 */
export function dpapiUnprotect(data: Buffer): Promise<Buffer> {
  const script = [
    "Add-Type -TypeDefinition 'using System; using System.Security.Cryptography; public class OCSession { public static byte[] U(byte[] d){ return ProtectedData.Unprotect(d, null, DataProtectionScope.CurrentUser); } }' -ReferencedAssemblies System.Security",
    `$b = [Convert]::FromBase64String('${data.toString("base64")}')`,
    "[Convert]::ToBase64String([OCSession]::U($b))",
  ].join("; ")
  return execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  }).then(({ stdout }) => {
    const b64 = stdout.trim()
    if (!b64) throw new Error("DPAPI returned an empty key")
    return Buffer.from(b64, "base64")
  })
}

/**
 * Read a password from the macOS Keychain using the platform's `security` CLI.
 */
export function keychainPassword(service: string, account: string): Promise<string> {
  return execFileAsync("/usr/bin/security", ["find-generic-password", "-w", "-s", service, "-a", account], {
    maxBuffer: 1024 * 1024,
  }).then(({ stdout }) => stdout.trim())
}
