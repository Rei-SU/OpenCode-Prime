import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"

const BAR_WIDTH = 20

export function ProgressBar(props: { api: TuiPluginApi; used: number; limit: number }) {
  const theme = () => props.api.theme.current
  const pct = createMemo(() => (!props.limit ? null : Math.round((props.used / props.limit) * 100)))
  const color = () => {
    const value = pct()
    if (value === null) return theme().textMuted
    if (value >= 100) return theme().error
    if (value >= 75) return theme().warning
    return theme().success
  }
  const filled = () => {
    const value = pct()
    if (value === null) return 0
    return Math.round((Math.min(100, Math.max(0, value)) / 100) * BAR_WIDTH)
  }

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={theme().textMuted}>
        <span style={{ fg: color() }}>{"█".repeat(filled())}</span>
        {"░".repeat(BAR_WIDTH - filled())}
      </text>
      <text fg={color()}>{pct() !== null ? `${pct()}%` : ""}</text>
    </box>
  )
}
