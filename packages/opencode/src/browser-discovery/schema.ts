import { Schema } from "effect"

export const BrowserId = Schema.Literals([
  "chrome",
  "chromium",
  "edge",
  "brave",
  "arc",
  "firefox",
  "safari",
])
export type BrowserId = Schema.Schema.Type<typeof BrowserId>

export type BrowserCookie = {
  browser: BrowserId
  profile: string
  cookie: string
  modified: number
}
