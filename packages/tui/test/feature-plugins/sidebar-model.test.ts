import { describe, expect, test } from "bun:test"
import type { Model, Provider } from "@opencode-ai/sdk/v2"
import { billingPlan, selectedModel } from "../../src/feature-plugins/sidebar/model"

function model(costInput: number): Model {
  return { cost: { input: costInput, output: 0, cache: { read: 0, write: 0 } } } as unknown as Model
}

function provider(id: string, costInput: number): Provider {
  return { id, name: id, source: "custom", env: [], options: {}, models: { model: model(costInput) } } as Provider
}

describe("billingPlan", () => {
  test("classifies console Go models", () => {
    expect(billingPlan({ providerID: "opencode-go", modelID: "model", provider: provider("opencode-go", 0.14) })).toBe(
      "go",
    )
  })

  test("classifies paid Zen models", () => {
    expect(billingPlan({ providerID: "opencode", modelID: "model", provider: provider("opencode", 0.14) })).toBe("zen")
    expect(billingPlan({ providerID: "zenmux", modelID: "model", provider: provider("zenmux", 0.3) })).toBe("zen")
  })

  test("classifies free console models as free", () => {
    expect(billingPlan({ providerID: "opencode", modelID: "model", provider: provider("opencode", 0) })).toBe("free")
    expect(billingPlan({ providerID: "opencode-go", modelID: "model", provider: provider("opencode-go", 0) })).toBe(
      "free",
    )
    expect(billingPlan({ providerID: "zenmux", modelID: "model", provider: provider("zenmux", 0) })).toBe("free")
  })

  test("classifies bring-your-own-key providers as free", () => {
    expect(
      billingPlan({ providerID: "anthropic", modelID: "model", provider: provider("anthropic", 3) }),
    ).toBe("free")
  })

  test("returns undefined without an active model", () => {
    expect(billingPlan(undefined)).toBeUndefined()
  })
})

describe("selectedModel", () => {
  test("resolves the selected model to provider metadata", () => {
    const api = {
      state: {
        selectedModel: () => ({ providerID: "opencode-go", modelID: "model" }),
        provider: [provider("opencode-go", 0.14)],
      },
    } as unknown as Parameters<typeof selectedModel>[0]

    expect(selectedModel(api)).toEqual({
      providerID: "opencode-go",
      modelID: "model",
      provider: provider("opencode-go", 0.14),
    })
  })

  test("returns undefined without a selected model", () => {
    const api = {
      state: { selectedModel: () => undefined, provider: [] },
    } as unknown as Parameters<typeof selectedModel>[0]

    expect(selectedModel(api)).toBeUndefined()
  })
})
