import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Option } from "effect"

import { installedBrowsers } from "./detector"
import { findChromiumAuthCookie } from "./providers/chromium"
import { findFirefoxAuthCookie } from "./providers/firefox"
import { findSafariAuthCookie } from "./providers/safari"
import type { BrowserCookie, BrowserId } from "./schema"

/**
 * Browser cookie discovery.
 *
 * Why reading cookie stores is the preferred automatic mechanism (as opposed
 * to browser automation APIs):
 *
 * - Playwright persistent contexts / CDP require launching or attaching to a
 *   browser, which locks the user's real profile and is visibly disruptive.
 * - There is no OS API that hands over another application's authenticated
 *   session; the only non-disruptive, background mechanism is reading the
 *   browser's cookie store and decrypting it with the platform's own
 *   protection APIs (DPAPI / Keychain / plaintext). That is what this
 *   subsystem does.
 * - Every failure path (browser not installed, locked profile, corrupt DB,
 *   missing keychain access, undecryptable v20 cookies) degrades to "skip
 *   this browser and continue", so the subsystem is safe to run on any
 *   machine with no side effects.
 */
function findIn(browser: BrowserId): Promise<BrowserCookie | undefined> {
  switch (browser) {
    case "firefox":
      return findFirefoxAuthCookie()
    case "safari":
      return Promise.resolve(findSafariAuthCookie())
    default:
      return findChromiumAuthCookie(browser)
  }
}

function fromUndefined<A>(value: A | undefined): Option.Option<A> {
  return value === undefined ? Option.none() : Option.some(value)
}

const checkBrowser = (browser: BrowserId) =>
  Effect.tryPromise(() => findIn(browser)).pipe(
    Effect.map(fromUndefined),
    Effect.catch(() => Effect.succeed(Option.none<BrowserCookie>())),
  )

export interface Interface {
  readonly installed: () => Effect.Effect<ReadonlyArray<BrowserId>>
  readonly checkBrowser: (browser: BrowserId) => Effect.Effect<Option.Option<BrowserCookie>>
  readonly findAuthCookie: () => Effect.Effect<Option.Option<BrowserCookie>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserDiscovery") {}

const layer: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of({
    installed: () => Effect.sync(installedBrowsers),
    checkBrowser,
    findAuthCookie: () =>
      Effect.gen(function* () {
        let best: BrowserCookie | undefined
        for (const browser of installedBrowsers()) {
          const found = yield* checkBrowser(browser)
          if (Option.isSome(found) && (!best || found.value.modified > best.modified)) best = found.value
        }
        return best ? Option.some(best) : Option.none<BrowserCookie>()
      }),
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [] })

export * as BrowserDiscovery from "./discovery"
