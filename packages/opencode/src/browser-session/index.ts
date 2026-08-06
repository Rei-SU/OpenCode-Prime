import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient } from "effect/unstable/http"

import { BrowserDiscovery } from "@/browser-discovery"

import { BrowserSessionError, isGoUsageInfo, type GoUsageInfo } from "./schema"
import { assertHttps, discoverServerFunctionId, replayServerFunction } from "./transport"

export type { GoUsageInfo } from "./schema"

const SERVER_FUNCTION_NAME = "lite.subscription.get"
export const DEFAULT_SERVER = "https://opencode.ai"

export type Session = {
  serverUrl: string
  cookie: string
  workspaceId?: string
  hashes: Record<string, string>
}

// Accept the raw `auth=...` cookie or a bare value pasted from the browser.
export function normalizeCookie(cookie: string): string {
  const parts = cookie.split(";").map((part) => part.trim())
  const auth = parts.find((part) => part.startsWith("auth="))
  if (auth) return auth
  return cookie.includes("=") ? cookie : `auth=${cookie}`
}

export type DiagnoseResult = { ok: true; usage: GoUsageInfo } | { ok: false; message: string }

export interface Interface {
  readonly importCookie: (input: {
    serverUrl: string
    cookie: string
    workspaceId?: string
  }) => Effect.Effect<void, BrowserSessionError>
  readonly clear: () => Effect.Effect<void, BrowserSessionError>
  readonly session: () => Effect.Effect<Option.Option<Session>, BrowserSessionError>
  readonly hasSession: () => Effect.Effect<boolean>
  readonly ensureSession: () => Effect.Effect<Option.Option<Session>, BrowserSessionError>
  readonly discover: () => Effect.Effect<Option.Option<Session>, BrowserSessionError>
  readonly fetchGoUsage: (workspaceId: string) => Effect.Effect<Option.Option<GoUsageInfo>, BrowserSessionError>
  readonly diagnose: (workspaceId: string) => Effect.Effect<DiagnoseResult, BrowserSessionError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserSession") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient | BrowserDiscovery.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const discovery = yield* BrowserDiscovery.Service

    // The session — including the browser auth cookie — exists only in this
    // closure for the lifetime of the process. It is never written to disk,
    // logs, or telemetry. When the process exits the reference is dropped and
    // discovery simply runs again on the next launch.
    let session: Session | undefined

    const dropSession = () => {
      session = undefined
    }

    // Discover the user's workspace id from the console's `/auth` redirect.
    // Uses the platform fetch with `redirect: "manual"` because the Effect
    // HTTP client follows redirects and would hide the Location header.
    const resolveWorkspace = (serverUrl: string, cookie: string): Effect.Effect<Option.Option<string>> =>
      Effect.tryPromise(async (): Promise<Option.Option<string>> => {
        const response = await globalThis.fetch(`${serverUrl}/auth`, {
          headers: { cookie },
          redirect: "manual",
        })
        const location = response.headers.get("location")
        const match = location?.match(/\/workspace\/([^/?#]+)/)
        return match ? Option.some(match[1]) : Option.none<string>()
      }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())))

    // Discover a cookie from the browser, resolve the workspace id, and cache
    // the resulting session in memory only.
    const discoverFromBrowser = (): Effect.Effect<Option.Option<Session>, BrowserSessionError> =>
      discovery.findAuthCookie().pipe(
        Effect.flatMap((cookie) =>
          Option.isSome(cookie)
            ? Effect.gen(function* () {
                const workspaceId = yield* resolveWorkspace(DEFAULT_SERVER, cookie.value.cookie)
                if (Option.isNone(workspaceId)) return Option.none<Session>()
                const next: Session = {
                  serverUrl: DEFAULT_SERVER,
                  cookie: cookie.value.cookie,
                  workspaceId: workspaceId.value,
                  hashes: {},
                }
                session = next
                return Option.some(next)
              })
            : Effect.succeed(Option.none<Session>()),
        ),
        Effect.catch(() => Effect.succeed(Option.none<Session>())),
      )

    // Ordered list of automatic session sources. Browser cookie discovery is
    // the first (non-disruptive, background) mechanism; future sources — for
    // example an OAuth flow that mints a session directly — are appended here
    // and tried in order until one yields a session.
    const sources: ReadonlyArray<() => Effect.Effect<Option.Option<Session>, BrowserSessionError>> = [
      discoverFromBrowser,
    ]

    const findSession = (): Effect.Effect<Option.Option<Session>, BrowserSessionError> =>
      Effect.gen(function* () {
        for (const source of sources) {
          const found = yield* source()
          if (Option.isSome(found)) return found
        }
        return Option.none<Session>()
      })

    const ensureSession = Effect.fn("BrowserSession.ensureSession")(() =>
      session ? Effect.succeed(Option.some(session)) : findSession(),
    )

    const importCookie = Effect.fn("BrowserSession.importCookie")((input: {
      serverUrl: string
      cookie: string
      workspaceId?: string
    }) =>
      Effect.gen(function* () {
        yield* assertHttps(input.serverUrl)
        session = {
          serverUrl: input.serverUrl,
          cookie: normalizeCookie(input.cookie),
          workspaceId: input.workspaceId,
          hashes: session?.serverUrl === input.serverUrl ? session.hashes : {},
        }
      }),
    )

    const clear = Effect.fn("BrowserSession.clear")(() => Effect.sync(dropSession))

    const sessionEffect = Effect.fn("BrowserSession.session")(() =>
      Effect.succeed(session === undefined ? Option.none<Session>() : Option.some(session)),
    )

    const hasSession = Effect.fn("BrowserSession.hasSession")(() => Effect.succeed(session !== undefined))

    const discover = Effect.fn("BrowserSession.discover")(() => findSession())

    const fetch = (workspaceId: string) =>
      ensureSession().pipe(
        Effect.flatMap((found) =>
          Option.isSome(found)
            ? fetchSession(found.value, found.value.workspaceId ?? workspaceId)
            : Effect.fail(new BrowserSessionError({ message: "No browser session", kind: "no_session" })),
        ),
      )

    const fetchSession = (current: Session, workspaceId: string) =>
      Effect.gen(function* () {
        let hash = current.hashes[SERVER_FUNCTION_NAME]
        if (!hash) {
          hash = yield* discoverServerFunctionId(
            http,
            { serverUrl: current.serverUrl, cookie: current.cookie, workspaceId },
            SERVER_FUNCTION_NAME,
          )
          current.hashes[SERVER_FUNCTION_NAME] = hash
        }
        const value = yield* replayServerFunction(
          http,
          { serverUrl: current.serverUrl, cookie: current.cookie },
          SERVER_FUNCTION_NAME,
          hash,
          [workspaceId],
        )
        if (!isGoUsageInfo(value)) {
          return yield* Effect.fail(
            new BrowserSessionError({ message: "Unexpected server function payload", kind: "decode" }),
          )
        }
        return value
      })

    const fetchGoUsage = Effect.fn("BrowserSession.fetchGoUsage")((workspaceId: string) =>
      fetch(workspaceId).pipe(
        Effect.map(Option.some),
        Effect.catch((error) => {
          // A stale hash signals a deployment update: invalidate, rediscover, retry once.
          if (error instanceof BrowserSessionError && error.kind === "stale_hash") {
            if (session) delete session.hashes[SERVER_FUNCTION_NAME]
            return fetch(workspaceId).pipe(
              Effect.map(Option.some),
              Effect.catch(() => Effect.succeed(Option.none<GoUsageInfo>())),
            )
          }
          // An authentication failure means the cached cookie is stale: drop it
          // and re-run the session sources (re-scan browsers), then retry once.
          if (error instanceof BrowserSessionError && error.kind === "replay") {
            dropSession()
            return findSession().pipe(
              Effect.flatMap((next) => (Option.isSome(next) ? fetch(workspaceId) : Effect.fail(error))),
              Effect.map(Option.some),
              Effect.catch(() => Effect.succeed(Option.none<GoUsageInfo>())),
            )
          }
          return Effect.succeed(Option.none<GoUsageInfo>())
        }),
      ),
    )

    const diagnose = Effect.fn("BrowserSession.diagnose")((workspaceId: string) =>
      fetch(workspaceId).pipe(
        Effect.map((usage) => ({ ok: true as const, usage })),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false as const,
            message: error instanceof BrowserSessionError ? error.message : `Unexpected error: ${String(error)}`,
          }),
        ),
      ),
    )

    return Service.of({
      importCookie,
      clear,
      session: sessionEffect,
      hasSession,
      ensureSession,
      discover,
      fetchGoUsage,
      diagnose,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [httpClient, BrowserDiscovery.node],
})

export * as BrowserSession from "."
