import { Effect } from "effect"
import { Headers, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { deserialize } from "seroval"

import { BrowserSessionError } from "./schema"

const SERVER_FUNCTION_PATH = "/_server"
const SERVER_FN_INSTANCE = "server-fn:0"
const HASH_PATTERN = /createServerReference\("([0-9a-f]{64})"\)/g
const ASSET_PATTERN = /(?:src|href)="([^"]+\.js)"/g

// seroval serializes cross-references against a global `self.$R` store. Bun
// provides a browser-compatible `self`; make it available for other runtimes.
const scope = globalThis as unknown as { self?: unknown }
if (scope.self === undefined) scope.self = globalThis

export function replayUrl(serverUrl: string, hash: string, args: unknown[]): string {
  return `${serverUrl}${SERVER_FUNCTION_PATH}?id=${encodeURIComponent(hash)}&args=${encodeURIComponent(JSON.stringify(args))}`
}

export function decodeServerFunctionBody(body: string): unknown {
  const payload = body.startsWith(";0x") ? body.replace(/^;0x[0-9a-f]+;/, "") : body
  return deserialize(payload)
}

export function assetUrls(html: string): string[] {
  const urls = new Set<string>()
  for (const match of html.matchAll(ASSET_PATTERN)) {
    const url = match[1]
    if (url && (url.startsWith("/") || url.startsWith("http"))) urls.add(url)
  }
  return [...urls]
}

// The bundle emits `createServerReference("<hash>")` immediately before
// `query(<ref>, "<name>")`. The target name's id is the last reference hash
// that appears before the name string in the module.
export function serverFunctionId(code: string, fnName: string): string | undefined {
  const target = code.indexOf(`"${fnName}"`)
  if (target === -1) return undefined
  let last: string | undefined
  for (const match of code.matchAll(HASH_PATTERN)) {
    if (match.index !== undefined && match.index > target) break
    last = match[1]
  }
  return last
}

function absoluteUrl(serverUrl: string, url: string): string {
  return new URL(url, serverUrl).toString()
}

const getText = (http: HttpClient.HttpClient, url: string, headers: Record<string, string>) =>
  HttpClient.filterStatusOk(http)
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers)))
    .pipe(
      Effect.flatMap((response) => response.text),
      Effect.mapError(
        (error) => new BrowserSessionError({ message: `Request failed: ${url}`, kind: "discovery", cause: error }),
      ),
    )

export const discoverServerFunctionId = (
  http: HttpClient.HttpClient,
  input: { serverUrl: string; cookie: string; workspaceId: string },
  fnName: string,
) =>
  Effect.gen(function* () {
    const page = `${input.serverUrl}/workspace/${input.workspaceId}/go`
    const html = yield* getText(http, page, { cookie: input.cookie })
    for (const url of assetUrls(html)) {
      const code = yield* getText(http, absoluteUrl(input.serverUrl, url), {}).pipe(
        Effect.catch(() => Effect.succeed("")),
      )
      const id = serverFunctionId(code, fnName)
      if (id) return id
    }
    return yield* Effect.fail(
      new BrowserSessionError({ message: `Server function not found in bundle: ${fnName}`, kind: "discovery" }),
    )
  })

export const replayServerFunction = (
  http: HttpClient.HttpClient,
  input: { serverUrl: string; cookie: string },
  fnName: string,
  hash: string,
  args: unknown[],
) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.get(replayUrl(input.serverUrl, hash, args)).pipe(
      HttpClientRequest.setHeaders({
        "x-server-id": hash,
        "x-server-instance": SERVER_FN_INSTANCE,
        cookie: input.cookie,
      }),
    )
    const response = yield* http
      .execute(request)
      .pipe(Effect.mapError((error) => new BrowserSessionError({ message: `Replay of ${fnName} failed`, kind: "replay", cause: error })))
    if (Headers.has(response.headers, "location") || Headers.has(response.headers, "x-error")) {
      return yield* Effect.fail(
        new BrowserSessionError({ message: `Server function ${fnName} rejected the session`, kind: "replay" }),
      )
    }
    if (response.status !== 200) {
      return yield* Effect.fail(
        new BrowserSessionError({ message: `Server function ${fnName} returned ${response.status}`, kind: "stale_hash" }),
      )
    }
    const body = yield* response.text.pipe(
      Effect.mapError((error) => new BrowserSessionError({ message: "Failed to read server function response", kind: "decode", cause: error })),
    )
    try {
      return decodeServerFunctionBody(body)
    } catch (cause) {
      return yield* Effect.fail(
        new BrowserSessionError({ message: "Failed to decode server function response", kind: "decode", cause }),
      )
    }
  })
