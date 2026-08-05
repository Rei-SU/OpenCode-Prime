import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { Show, createMemo } from "solid-js"
import { ProgressBar } from "../../component/progress-bar"
import { selectedModel } from "./model"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  const context = createMemo(() => {
    const model = selectedModel(props.api)
    const limit = model?.provider?.models[model.modelID]?.limit.context
    if (!limit) return undefined
    const messages = props.api.state.session.messages(props.session_id)
    const last = messages.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return undefined
    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return undefined
    return { tokens, limit }
  })

  return (
    <box gap={1}>
      <Show when={context()}>
        {(item) => (
          <>
            <text fg={theme().text}>
              <b>Context</b>
            </text>
            <box>
              <box flexDirection="row" justifyContent="space-between" alignItems="center">
                <text fg={theme().textMuted}>
                  {Locale.number(item().tokens)} / {Locale.number(item().limit)} tokens
                </text>
                <Show when={cost() >= 0.005}>
                  <text fg={theme().textMuted}>Spent : {money.format(cost())}</text>
                </Show>
              </box>
              <ProgressBar api={props.api} used={item().tokens} limit={item().limit} />
            </box>
          </>
        )}
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
