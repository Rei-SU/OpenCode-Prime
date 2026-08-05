export type { BrowserId, BrowserCookie } from "./schema"

export { isInstalled, installedBrowsers, ALL_BROWSERS } from "./detector"

export { chromiumKey, decryptChromiumCookie } from "./crypto"

export { chromiumProfiles, findChromiumAuthCookie, readProfileCookie } from "./providers/chromium"
export { firefoxProfiles, findFirefoxAuthCookie, decryptFirefoxValue } from "./providers/firefox"
export { findSafariAuthCookie } from "./providers/safari"

export * as BrowserDiscovery from "./discovery"
