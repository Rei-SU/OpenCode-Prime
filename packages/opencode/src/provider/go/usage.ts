import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Option } from "effect"

import { BrowserSession } from "@/browser-session"

export type Usage = {
  plan: string
  rollingUsed: number
  rollingLimit: number
  weeklyUsed: number
  weeklyLimit: number
  monthlyUsed: number
  monthlyLimit: number
  resetTime: number
}

export interface Interface {
  readonly get: () => Effect.Effect<Option.Option<Usage>>
  readonly hasSession: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GoUsage") {}

const layer: Layer.Layer<Service, never, BrowserSession.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const browser = yield* BrowserSession.Service

    const get = Effect.fn("GoUsage.get")(() =>
      Effect.gen(function* () {
        const current = yield* browser.ensureSession()
        if (Option.isNone(current)) return Option.none<Usage>()
        const workspaceId = current.value.workspaceId
        if (!workspaceId) return Option.none<Usage>()
        const info = yield* browser.fetchGoUsage(workspaceId)
        if (Option.isNone(info)) return Option.none<Usage>()
        const usage = info.value
        return Option.some({
          plan: "Go",
          rollingUsed: usage.rollingUsage.usagePercent,
          rollingLimit: 100,
          weeklyUsed: usage.weeklyUsage.usagePercent,
          weeklyLimit: 100,
          monthlyUsed: usage.monthlyUsage.usagePercent,
          monthlyLimit: 100,
          resetTime: Date.now() + usage.rollingUsage.resetInSec * 1000,
        })
      }).pipe(Effect.catch(() => Effect.succeed(Option.none<Usage>()))),
    )

    const hasSession = Effect.fn("GoUsage.hasSession")(() =>
      browser.hasSession().pipe(Effect.catch(() => Effect.succeed(false))),
    )

    return Service.of({ get, hasSession })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [BrowserSession.node] })

export * as GoUsage from "./usage"
