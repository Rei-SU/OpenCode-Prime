import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"
import { ProgressBar } from "../../component/progress-bar"
import { selectedModel, billingPlan } from "./model"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-plan"

const REFRESH_INTERVAL_MS = 60_000
const MODEL_NAME_MAX_WIDTH = 32

// OpenCode Free tier request quota, as documented on the OpenCode plans page.
// The Console does not expose free usage yet, so this is the known limit.
const FREE_DAILY_REQUESTS = 200

const BADGE_BACKGROUND = RGBA.fromInts(255, 255, 255)
const BADGE_FOREGROUND = RGBA.fromInts(0, 0, 0)

function formatCountdown(now: number, resetTime: number) {
  const seconds = Math.max(0, Math.ceil((resetTime - now) / 1000))
  if (seconds <= 0) return "now"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.ceil((seconds % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

function UsageRow(props: { api: TuiPluginApi; label: string; used: number; limit: number }) {
  const theme = () => props.api.theme.current
  return (
    <box flexDirection="row" alignItems="center">
      <text fg={theme().textMuted} wrapMode="none">
        {props.label.padEnd(8)}
      </text>
      <ProgressBar api={props.api} used={props.used} limit={props.limit} />
    </box>
  )
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const model = createMemo(() => selectedModel(props.api))
  const plan = createMemo(() => billingPlan(model()))
  const modelName = createMemo(() => {
    const value = model()
    if (!value) return undefined
    const name = value.provider?.models[value.modelID]?.name ?? value.modelID
    return Locale.truncate(name, MODEL_NAME_MAX_WIDTH)
  })

  const [usage, { refetch }] = createResource(() =>
    plan() === "go" ? props.api.goUsage() : Promise.resolve(undefined),
  )
  const [sessionExists, { refetch: refetchSession }] = createResource(
    () => (plan() === "go" ? props.api.goSession() : Promise.resolve(false)),
  )
  const [now, setNow] = createSignal(Date.now())

  let lastRefetch = Date.now()
  const timer = setInterval(() => {
    const current = Date.now()
    setNow(current)
    if (plan() === "go" && current - lastRefetch >= REFRESH_INTERVAL_MS) {
      lastRefetch = current
      void refetch()
      void refetchSession()
    }
  }, 1000)
  onCleanup(() => clearInterval(timer))

  const data = () => usage()
  const countdown = createMemo(() => (data() ? formatCountdown(now(), data()!.resetTime) : ""))

  const status = createMemo(() => {
    if (plan() !== "go") return undefined
    if (data()) return "live"
    if (usage.loading || sessionExists.loading) return undefined
    return sessionExists() ? "cached" : "none"
  })
  const statusColor = createMemo(() => {
    const value = status()
    if (value === "live") return theme().success
    if (value === "cached") return theme().warning
    if (value === "none") return theme().error
    return theme().textMuted
  })

  return (
    <Show when={plan()}>
      {(planValue) => (
        <box gap={1}>
          <box flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={theme().text}>
              <b>OpenCode</b>
            </text>
            <box
              backgroundColor={BADGE_BACKGROUND}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={BADGE_FOREGROUND}>{planValue().toUpperCase()}</text>
            </box>
          </box>
          <Show when={modelName()}>
            {(name) => (
              <box flexDirection="row" gap={1} alignItems="center">
                <Show when={planValue() === "go"}>
                  <text fg={statusColor()}>●</text>
                </Show>
                <text fg={theme().textMuted} wrapMode="none">
                  {name()}
                </text>
              </box>
            )}
          </Show>
          <Show when={planValue() === "go" && data()}>
            {(item) => (
              <box gap={1}>
                <UsageRow api={props.api} label="Rolling" used={item().rollingUsed} limit={item().rollingLimit} />
                <UsageRow api={props.api} label="Weekly" used={item().weeklyUsed} limit={item().weeklyLimit} />
                <UsageRow api={props.api} label="Monthly" used={item().monthlyUsed} limit={item().monthlyLimit} />
                <text fg={theme().textMuted}>Resets in {countdown()}</text>
              </box>
            )}
          </Show>
          <Show when={planValue() === "zen"}>
            <text fg={theme().textMuted} wrapMode="word">
              Zen usage is not currently exposed by OpenCode.
            </text>
          </Show>
          <Show when={planValue() === "free"}>
            <text fg={theme().textMuted} wrapMode="word">
              Free tier · {FREE_DAILY_REQUESTS} requests/day
            </text>
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, _props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
