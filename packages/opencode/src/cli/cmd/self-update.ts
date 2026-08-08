import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { chmodSync, copyFileSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { UPDATE_REPO } from "../../installation"
import { UI } from "../ui"

const APP = "opencode-prime"

// Matches the artifact naming contract used by install.sh / install.ps1 and
// the prime-release workflow (e.g. `opencode-prime-linux-x64.tar.gz`).
function artifactName(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "arm64" || process.arch === "x64" ? process.arch : "x64"
  const ext = platform === "linux" ? "tar.gz" : "zip"
  return `${APP}-${platform}-${arch}.${ext}`
}

function findBinary(dir: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findBinary(full)
      if (found) return found
    } else if (entry.name === APP || entry.name === `${APP}.exe`) {
      return full
    }
  }
  return undefined
}

// Replace the running executable.
//
// - POSIX: write the new binary to a staging file in the same directory, then
//   `rename` over the running path. rename(2) over a live executable is atomic
//   and safe — the running process keeps the old inode until it exits.
// - Windows: a running .exe is locked, so write `opencode-prime.exe.new` and
//   spawn a detached PowerShell helper that retries the swap until this process
//   exits. Paths are passed via environment variables and the script via
//   `-EncodedCommand` to avoid all quoting issues.
function replaceBinary(binary: string) {
  const dir = path.dirname(process.execPath)
  if (process.platform === "win32") {
    const staging = path.join(dir, `${APP}.new`)
    const log = path.join(dir, `${APP}-update.log`)
    copyFileSync(binary, staging)
    // The running .exe cannot be removed until this process exits. The helper
    // polls for that with a generous timeout, then renames the staged binary
    // into place. Both steps retry: Windows keeps the old file in a
    // delete-pending state right after removal (and AV may hold a transient
    // lock), so a single-shot Move-Item is unreliable.
    const script = [
      "$log = $env:OP_LOG",
      "$old = $env:OP_OLD",
      "$new = $env:OP_NEW",
      "function Log($msg) {",
      "  try { Add-Content -LiteralPath $log -Value ('{0:o} {1}' -f (Get-Date), $msg) -ErrorAction SilentlyContinue } catch {}",
      "}",
      "Log 'helper start'",
      "$deadline = (Get-Date).AddSeconds(600)",
      "$removed = $false",
      "while (-not $removed) {",
      "  if ((Get-Date) -gt $deadline) { Log 'timeout waiting for the running exe to be removable'; break }",
      "  if (-not (Test-Path -LiteralPath $old)) { $removed = $true; break }",
      "  Start-Sleep -Milliseconds 500",
      "  try { Remove-Item -LiteralPath $old -Force -ErrorAction Stop; $removed = $true } catch { Log ('remove failed: ' + $_.Exception.Message) }",
      "}",
      "Start-Sleep -Milliseconds 500",
      "$moved = $false",
      "for ($i = 0; $i -lt 20; $i++) {",
      "  try { Move-Item -LiteralPath $new $old -Force -ErrorAction Stop; $moved = $true; break }",
      "  catch { Log ('move failed (attempt ' + $i + '): ' + $_.Exception.Message); Start-Sleep -Milliseconds 1000 }",
      "}",
      "Log ('helper done removed=' + $removed + ' moved=' + $moved)",
    ].join("\n")
    const encoded = Buffer.from(script, "utf16le").toString("base64")
    const helper = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, OP_OLD: process.execPath, OP_NEW: staging, OP_LOG: log },
      },
    )
    helper.unref()
    return
  }
  const staging = path.join(dir, `.${APP}.update`)
  copyFileSync(binary, staging)
  chmodSync(staging, 0o755)
  renameSync(staging, process.execPath)
}

export const SelfUpdateCommand = {
  command: "self-update",
  describe: "update opencode-prime to the latest dev build from GitHub releases",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Self-update")

    const artifact = artifactName()
    const url = `https://github.com/${UPDATE_REPO}/releases/latest/download/${artifact}`
    const tmp = mkdtempSync(path.join(os.tmpdir(), "opencode-prime-update-"))
    try {
      prompts.log.info(`Downloading ${artifact} from the latest release`)

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}). Make sure a release has been built: ${url}`)
      }
      const archive = path.join(tmp, artifact)
      writeFileSync(archive, Buffer.from(await response.arrayBuffer()))

      const extractArgs =
        process.platform === "linux" ? ["-xzf", archive, "-C", tmp] : ["-xf", archive, "-C", tmp]
      const extract = spawnSync("tar", extractArgs, { stdio: "pipe" })
      if (extract.status !== 0) {
        throw new Error(`Failed to extract ${artifact}: ${extract.stderr?.toString() || "tar failed"}`)
      }

      const binary = findBinary(tmp)
      if (!binary) throw new Error(`Archive did not contain the ${APP} binary`)

      if (process.platform !== "win32") chmodSync(binary, 0o755)
      const probe = spawnSync(binary, ["--version"], { stdio: "pipe" })
      if (probe.status !== 0) throw new Error("Downloaded binary failed to run")

      const version = probe.stdout.toString().trim()
      if (version === InstallationVersion) {
        prompts.log.info(`Already up to date (${InstallationVersion})`)
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Updating ${InstallationVersion} → ${version}`)
      replaceBinary(binary)

      if (process.platform === "win32") {
        prompts.log.success(`Downloaded ${version}. It will be applied when this session exits — run ${APP} again to use it.`)
      } else {
        prompts.log.success(`Updated to ${version}`)
      }
    } catch (err) {
      prompts.log.error(err instanceof Error ? err.message : String(err))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    prompts.outro("Done")
  },
}
