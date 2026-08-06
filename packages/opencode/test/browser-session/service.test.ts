import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { BrowserSession } from "../../src/browser-session"
import { BrowserDiscovery } from "../../src/browser-discovery"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([])))

const noDiscovery = Layer.succeed(
  BrowserDiscovery.Service,
  BrowserDiscovery.Service.of({
    installed: () => Effect.succeed([]),
    checkBrowser: () => Effect.succeed(Option.none()),
    findAuthCookie: () => Effect.succeed(Option.none()),
  }),
)

const live = (client: HttpClient.HttpClient) =>
  LayerNode.compile(BrowserSession.node, [
    [httpClient, Layer.succeed(HttpClient.HttpClient, client)],
    [BrowserDiscovery.node, noDiscovery],
  ])

const text = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: string, status = 200) =>
  HttpClientResponse.fromWeb(req, new Response(body, { status, headers: { "content-type": "text/javascript" } }))

const HASH = "c".repeat(64)
const SERVER = "https://opencode.test"
const WORKSPACE = "wrk_123"
const COOKIE = "auth=sealed"
const PAGE = `<html><head><link rel="modulepreload" href="/_build/assets/app.js"></head></html>`
const BUNDLE = `const queryLiteSubscription_query = createServerReference("${HASH}");\nconst queryLiteSubscription = query(queryLiteSubscription_query, "lite.subscription.get");`
const USAGE = `;0x00000149;((self.$R=self.$R||{})["server-fn:0"]=[],($R=>$R[0]={mine:!0,useBalance:!1,region:$R[1]=["us","eu","sg","cn"],rollingUsage:$R[2]={status:"ok",resetInSec:10766,usagePercent:3},weeklyUsage:$R[3]={status:"ok",resetInSec:444242,usagePercent:9},monthlyUsage:$R[4]={status:"ok",resetInSec:2421543,usagePercent:34}})($R["server-fn:0"]))`

function mockClient(opts: {
  onPage?: () => void
  onServer?: (call: number) => { status: number; body?: string; location?: string }
}) {
  let pageCalls = 0
  let serverCalls = 0
  const client = HttpClient.make((req) =>
    Effect.gen(function* () {
      if (req.url.includes(`/workspace/${WORKSPACE}/go`)) {
        pageCalls += 1
        opts.onPage?.()
        return text(req, PAGE)
      }
      if (req.url.endsWith("/_build/assets/app.js")) {
        return text(req, BUNDLE)
      }
      if (req.url.includes("/_server")) {
        const call = serverCalls
        serverCalls += 1
        const handled = opts.onServer?.(call)
        const status = handled?.status ?? 200
        const headers: Record<string, string> = { "content-type": "text/javascript" }
        if (handled?.location) headers["location"] = handled.location
        return HttpClientResponse.fromWeb(req, new Response(handled?.body ?? USAGE, { status, headers }))
      }
      return text(req, "", 404)
    }),
  )
  return { client, pageCalls: () => pageCalls, serverCalls: () => serverCalls }
}

it.live("importCookie persists a session", () =>
  Effect.gen(function* () {
    yield* BrowserSession.use.importCookie({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE })
    const has = yield* BrowserSession.use.hasSession()
    expect(has).toBe(true)
    const session = yield* BrowserSession.use.session()
    expect(Option.getOrThrow(session)).toEqual(
      expect.objectContaining({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE, hashes: {} }),
    )
  }).pipe(Effect.provide(live(mockClient({}).client))),
)

it.live("hasSession is false before importing a cookie", () =>
  Effect.gen(function* () {
    const has = yield* BrowserSession.use.hasSession()
    expect(has).toBe(false)
  }).pipe(Effect.provide(live(mockClient({}).client))),
)

it.live("clear removes the session", () =>
  Effect.gen(function* () {
    yield* BrowserSession.use.importCookie({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE })
    yield* BrowserSession.use.clear()
    const has = yield* BrowserSession.use.hasSession()
    expect(has).toBe(false)
  }).pipe(Effect.provide(live(mockClient({}).client))),
)

it.live("fetchGoUsage discovers the hash, replays, and returns the usage", () => {
  const mock = mockClient({ onServer: () => ({ status: 200 }) })
  return Effect.gen(function* () {
    yield* BrowserSession.use.importCookie({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE })
    const first = yield* BrowserSession.use.fetchGoUsage(WORKSPACE)
    expect(Option.isSome(first)).toBe(true)
    expect(Option.getOrThrow(first)).toEqual({
      mine: true,
      useBalance: false,
      region: ["us", "eu", "sg", "cn"],
      rollingUsage: { status: "ok", resetInSec: 10766, usagePercent: 3 },
      weeklyUsage: { status: "ok", resetInSec: 444242, usagePercent: 9 },
      monthlyUsage: { status: "ok", resetInSec: 2421543, usagePercent: 34 },
    })
    expect(mock.pageCalls()).toBe(1)
    expect(mock.serverCalls()).toBe(1)

    // Second call reuses the cached hash: no rediscovery.
    const second = yield* BrowserSession.use.fetchGoUsage(WORKSPACE)
    expect(Option.isSome(second)).toBe(true)
    expect(mock.pageCalls()).toBe(1)
    expect(mock.serverCalls()).toBe(2)
  }).pipe(Effect.provide(live(mock.client)))
})

it.live("fetchGoUsage returns none without a session", () =>
  Effect.gen(function* () {
    const result = yield* BrowserSession.use.fetchGoUsage(WORKSPACE)
    expect(Option.isNone(result)).toBe(true)
  }).pipe(Effect.provide(live(mockClient({}).client))),
)

it.live("fetchGoUsage invalidates a stale hash, rediscovers, and retries once", () => {
  const mock = mockClient({ onServer: (call) => (call === 0 ? { status: 500, body: `{"status":500}` } : { status: 200 }) })
  return Effect.gen(function* () {
    yield* BrowserSession.use.importCookie({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE })
    const result = yield* BrowserSession.use.fetchGoUsage(WORKSPACE)
    expect(Option.isSome(result)).toBe(true)
    // initial replay + one retry after rediscovery
    expect(mock.serverCalls()).toBe(2)
    expect(mock.pageCalls()).toBe(2)
  }).pipe(Effect.provide(live(mock.client)))
})

it.live("fetchGoUsage returns none when the server rejects the session", () => {
  const mock = mockClient({ onServer: () => ({ status: 200, location: "/auth/authorize" }) })
  return Effect.gen(function* () {
    yield* BrowserSession.use.importCookie({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE })
    const result = yield* BrowserSession.use.fetchGoUsage(WORKSPACE)
    expect(Option.isNone(result)).toBe(true)
    expect(mock.serverCalls()).toBe(1)
  }).pipe(Effect.provide(live(mock.client)))
})

it.live("fetchGoUsage refreshes a rejected cookie from a browser and retries once", () => {
  const mock = mockClient({ onServer: (call) => (call === 0 ? { status: 200, location: "/auth/authorize" } : { status: 200 }) })
  const discovery = BrowserDiscovery.Service.of({
    installed: () => Effect.succeed([]),
    checkBrowser: () => Effect.succeed(Option.none()),
    findAuthCookie: () =>
      Effect.succeed(Option.some({ browser: "firefox", profile: "p", cookie: COOKIE, modified: Date.now() })),
  })
  const layer = LayerNode.compile(BrowserSession.node, [
    [httpClient, Layer.succeed(HttpClient.HttpClient, mock.client)],
    [BrowserDiscovery.node, Layer.succeed(BrowserDiscovery.Service, discovery)],
  ])
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("/auth")
      ? Promise.resolve(new Response(null, { status: 302, headers: { location: "/workspace/wrk_123" } }))
      : originalFetch(input, init)) as typeof fetch
  return Effect.gen(function* () {
    yield* BrowserSession.use.importCookie({ serverUrl: SERVER, cookie: COOKIE, workspaceId: WORKSPACE })
    const result = yield* BrowserSession.use.fetchGoUsage(WORKSPACE)
    expect(Option.isSome(result)).toBe(true)
    // initial rejected replay + one retry with the imported cookie
    expect(mock.serverCalls()).toBe(2)
  })
    .pipe(Effect.provide(layer))
    .pipe(
      Effect.ensuring(
        Effect.sync(() => {
          globalThis.fetch = originalFetch
        }),
      ),
    )
})
