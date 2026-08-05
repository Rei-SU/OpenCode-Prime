import { Schema } from "effect"

export class BrowserSessionError extends Schema.TaggedErrorClass<BrowserSessionError>()("BrowserSessionError", {
  message: Schema.String,
  kind: Schema.Literals(["no_session", "discovery", "replay", "stale_hash", "decode", "database"]),
  cause: Schema.optional(Schema.Defect()),
}) {}

export type WindowUsage = {
  status: string
  resetInSec: number
  usagePercent: number
}

export type GoUsageInfo = {
  mine: boolean
  useBalance: boolean
  region: string[]
  rollingUsage: WindowUsage
  weeklyUsage: WindowUsage
  monthlyUsage: WindowUsage
}

export function isGoUsageInfo(value: unknown): value is GoUsageInfo {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  const window = (name: string) => {
    const w = item[name]
    return (
      typeof w === "object" &&
      w !== null &&
      typeof (w as Record<string, unknown>)["resetInSec"] === "number" &&
      typeof (w as Record<string, unknown>)["usagePercent"] === "number"
    )
  }
  return window("rollingUsage") && window("weeklyUsage") && window("monthlyUsage")
}
