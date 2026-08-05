import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient } from "effect/unstable/http"

import { BrowserDiscovery } from "@/browser-discovery"

import { BrowserSessionRepo, decodeHashes, type SessionRow } from "./repo"
import { BrowserSessionError, isGoUsageInfo, type GoUsageInfo } from "./schema"
import { discoverServerFunctionId, replayServerFunction } from "./transport"

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

function decodeRow(row: SessionRow): Session {
  return {
    serverUrl: row.server_url,
    cookie: row.cookie,
    workspaceId: row.workspace_id ?? undefined,
    hashes: decodeHashes(row),
  }
}

const layer: Layer.Layer<Service, never, BrowserSessionRepo.Service | HttpClient.HttpClient | BrowserDiscovery.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const repo = yield* BrowserSessionRepo.Service
      const http = yield* HttpClient.HttpClient
      const discovery = yield* BrowserDiscovery.Service

      const importCookie = Effect.fn("BrowserSession.importCookie")((input: {
        serverUrl: string
        cookie: string
        workspaceId?: string
      }) =>
        repo.getByServerUrl(input.serverUrl).pipe(
          Effect.flatMap((existing) =>
            repo.upsert({
              serverUrl: input.serverUrl,
              cookie: normalizeCookie(input.cookie),
              workspaceId: input.workspaceId,
              hashes: Option.isSome(existing) ? decodeHashes(existing.value) : {},
            }),
          ),
        ),
      )

      const clear = Effect.fn("BrowserSession.clear")(() =>
        repo.get().pipe(
          Effect.flatMap((current) => (Option.isSome(current) ? repo.remove(current.value.server_url) : Effect.void)),
        ),
      )

      const session = Effect.fn("BrowserSession.session")(() =>
        repo.get().pipe(
          Effect.map(Option.map(decodeRow)),
          Effect.catch(() => Effect.succeed(Option.none<Session>())),
        ),
      )

      const hasSession = Effect.fn("BrowserSession.hasSession")(() =>
        repo.get().pipe(
          Effect.map(Option.isSome),
          Effect.catch(() => Effect.succeed(false)),
        ),
      )

      const cacheHash = (row: SessionRow, name: string, hash: string) =>
        repo.upsert({
          serverUrl: row.server_url,
          cookie: row.cookie,
          workspaceId: row.workspace_id ?? undefined,
          hashes: { ...decodeHashes(row), [name]: hash },
        })

      // Discover the user's workspace id from the console's `/auth` redirect.
      // Uses the platform fetch with `redirect: "manual"` because the Effect
      // HTTP client follows redirects and would hide the Location header.
      const resolveWorkspace = (
        serverUrl: string,
        cookie: string,
      ): Effect.Effect<Option.Option<string>> =>
        Effect.tryPromise(async (): Promise<Option.Option<string>> => {
          const response = await globalThis.fetch(`${serverUrl}/auth`, {
            headers: { cookie },
            redirect: "manual",
          })
          const location = response.headers.get("location")
          const match = location?.match(/\/workspace\/([^/?#]+)/)
          return match ? Option.some(match[1]) : Option.none<string>()
        }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())))

      // Import a discovered browser cookie: resolve the workspace id, persist,
      // and return the resulting row.
      const importDiscovered = (cookie: string) =>
        repo.getByServerUrl(DEFAULT_SERVER).pipe(
          Effect.flatMap((existing) =>
            Effect.gen(function* () {
              const workspaceId = yield* resolveWorkspace(DEFAULT_SERVER, cookie)
              if (Option.isNone(workspaceId)) return Option.none<SessionRow>()
              yield* repo.upsert({
                serverUrl: DEFAULT_SERVER,
                cookie,
                workspaceId: workspaceId.value,
                hashes: Option.isSome(existing) ? decodeHashes(existing.value) : {},
              })
              return yield* repo.get()
            }),
          ),
        )

      // Ordered list of automatic session sources. Browser cookie discovery is
      // the first (non-disruptive, background) mechanism; future sources — for
      // example an OAuth flow that mints a browser session directly — are
      // appended here and tried in order until one yields a session.
      const discoverFromBrowsers = (): Effect.Effect<Option.Option<SessionRow>, BrowserSessionError> =>
        discovery.findAuthCookie().pipe(
          Effect.flatMap((cookie) =>
            Option.isSome(cookie)
              ? importDiscovered(cookie.value.cookie)
              : Effect.succeed(Option.none<SessionRow>()),
          ),
          Effect.catch(() => Effect.succeed(Option.none<SessionRow>())),
        )

      const sources: ReadonlyArray<() => Effect.Effect<Option.Option<SessionRow>, BrowserSessionError>> = [
        discoverFromBrowsers,
      ]

      const findRow = () =>
        Effect.gen(function* () {
          for (const source of sources) {
            const found = yield* source()
            if (Option.isSome(found)) return found
          }
          return Option.none<SessionRow>()
        })

      const ensureRow = () => repo.get().pipe(Effect.flatMap((row) => (Option.isSome(row) ? Effect.succeed(row) : findRow())))

      const discover = Effect.fn("BrowserSession.discover")(() => findRow().pipe(Effect.map(Option.map(decodeRow))))

      const ensureSession = Effect.fn("BrowserSession.ensureSession")(() =>
        ensureRow().pipe(Effect.map(Option.map(decodeRow))),
      )

      const fetch = (workspaceId: string) =>
        ensureRow().pipe(
          Effect.flatMap((row) =>
            Option.isSome(row)
              ? fetchRow(row.value, workspaceId)
              : Effect.fail(new BrowserSessionError({ message: "No browser session", kind: "no_session" })),
          ),
        )

      const fetchRow = (row: SessionRow, workspaceId: string) =>
        Effect.gen(function* () {
          let hash = decodeHashes(row)[SERVER_FUNCTION_NAME]
          if (!hash) {
            hash = yield* discoverServerFunctionId(
              http,
              { serverUrl: row.server_url, cookie: row.cookie, workspaceId },
              SERVER_FUNCTION_NAME,
            )
            yield* cacheHash(row, SERVER_FUNCTION_NAME, hash)
          }
          const value = yield* replayServerFunction(
            http,
            { serverUrl: row.server_url, cookie: row.cookie },
            SERVER_FUNCTION_NAME,
            hash,
            [workspaceId],
          )
          if (!isGoUsageInfo(value)) {
            return yield* Effect.fail(new BrowserSessionError({ message: "Unexpected server function payload", kind: "decode" }))
          }
          return value
        })

      const fetchGoUsage = Effect.fn("BrowserSession.fetchGoUsage")((workspaceId: string) =>
        fetch(workspaceId).pipe(
          Effect.map(Option.some),
          Effect.catch((error) => {
            // A stale hash signals a deployment update: invalidate, rediscover, retry once.
            if (error instanceof BrowserSessionError && error.kind === "stale_hash") {
              return repo.get().pipe(
                Effect.flatMap((current) =>
                  Option.isSome(current) ? cacheHash(current.value, SERVER_FUNCTION_NAME, "") : Effect.void,
                ),
                Effect.flatMap(() => fetch(workspaceId)),
                Effect.map(Option.some),
                Effect.catch(() => Effect.succeed(Option.none<GoUsageInfo>())),
              )
            }
            // An authentication failure means the stored cookie is stale: run
            // the session sources (re-scan browsers), then retry exactly once.
            if (error instanceof BrowserSessionError && error.kind === "replay") {
              return findRow().pipe(
                Effect.flatMap((row) => (Option.isSome(row) ? fetch(workspaceId) : Effect.fail(error))),
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

      return Service.of({ importCookie, clear, session, hasSession, ensureSession, discover, fetchGoUsage, diagnose })
    }),
  )

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [BrowserSessionRepo.node, httpClient, BrowserDiscovery.node],
})

export * as BrowserSession from "."
