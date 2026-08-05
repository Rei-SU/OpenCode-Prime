import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Provider } from "@opencode-ai/sdk/v2"

export type ActiveModel = {
  providerID: string
  modelID: string
  provider: Provider | undefined
}

export type Plan = "go" | "zen" | "free"

export function selectedModel(api: TuiPluginApi): ActiveModel | undefined {
  const ref = api.state.selectedModel()
  if (!ref) return undefined
  const provider = api.state.provider.find((item) => item.id === ref.providerID)
  return { providerID: ref.providerID, modelID: ref.modelID, provider }
}

export function billingPlan(model: ActiveModel | undefined): Plan | undefined {
  if (!model) return undefined
  const id = model.providerID
  const costInput = model.provider?.models[model.modelID]?.cost.input ?? 0
  const free = costInput <= 0
  if (id.startsWith("opencode-go")) return free ? "free" : "go"
  if (id.startsWith("opencode") || id === "zenmux") return free ? "free" : "zen"
  return "free"
}
