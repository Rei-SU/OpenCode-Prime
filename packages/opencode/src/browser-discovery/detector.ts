import { existsSync } from "node:fs"

import { browserRoot } from "./platform"
import type { BrowserId } from "./schema"

export const ALL_BROWSERS: readonly BrowserId[] = [
  "chrome",
  "chromium",
  "edge",
  "brave",
  "arc",
  "firefox",
  "safari",
]

export function isInstalled(browser: BrowserId): boolean {
  const root = browserRoot(browser)
  return root.length > 0 && existsSync(root)
}

export function installedBrowsers(): BrowserId[] {
  return ALL_BROWSERS.filter(isInstalled)
}
