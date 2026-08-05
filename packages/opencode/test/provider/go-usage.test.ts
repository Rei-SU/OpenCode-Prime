import { expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Option } from "effect"

import { BrowserSession } from "../../src/browser-session"
import { GoUsage } from "../../src/provider/go/usage"

const SESSION: BrowserSession.Session = {
  serverUrl: "https://opencode.test",
  cookie: "auth=sealed",
  workspaceId: "wrk_123",
  hashes: {},
}

const USAGE: BrowserSession.GoUsageInfo = {
  mine: true,
  useBalance: false,
  region: ["us", "eu", "sg", "cn"],
  rollingUsage: { status: "ok", resetInSec: 10766, usagePercent: 3 },
  weeklyUsage: { status: "ok", resetInSec: 444242, usagePercent: 9 },
  monthlyUsage: { status: "ok", resetInSec: 2421543, usagePercent: 34 },
}

const browser = (session: Option.Option<BrowserSession.Session>, usage: Option.Option<BrowserSession.GoUsageInfo>) =>
  Layer.mock(BrowserSession.Service, {
    ensureSession: () => Effect.succeed(session),
    fetchGoUsage: () => Effect.succeed(usage),
  })

const get = (mock: Layer.Layer<BrowserSession.Service>) =>
  Effect.runPromise(
    GoUsage.Service.use((service) => service.get()).pipe(
      Effect.provide(LayerNode.compile(GoUsage.node, [[BrowserSession.node, mock]])),
    ),
  )

test("maps the console usage into the Usage shape", async () => {
  const usage = Option.getOrThrow(await get(browser(Option.some(SESSION), Option.some(USAGE))))
  expect(usage).toMatchObject({
    plan: "Go",
    rollingUsed: 3,
    rollingLimit: 100,
    weeklyUsed: 9,
    weeklyLimit: 100,
    monthlyUsed: 34,
    monthlyLimit: 100,
  })
  expect(usage.resetTime).toBeGreaterThan(Date.now())
})

test("returns none without a session", async () => {
  const result = await get(browser(Option.none(), Option.some(USAGE)))
  expect(Option.isNone(result)).toBe(true)
})

test("returns none when the session has no workspace id", async () => {
  const result = await get(browser(Option.some({ ...SESSION, workspaceId: undefined }), Option.some(USAGE)))
  expect(Option.isNone(result)).toBe(true)
})

test("returns none when usage is unavailable", async () => {
  const result = await get(browser(Option.some(SESSION), Option.none()))
  expect(Option.isNone(result)).toBe(true)
})
