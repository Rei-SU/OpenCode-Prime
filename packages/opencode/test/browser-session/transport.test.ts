import { describe, expect, test } from "bun:test"

import { assetUrls, decodeServerFunctionBody, replayUrl, serverFunctionId } from "../../src/browser-session/transport"

const USAGE_BODY = `;0x00000149;((self.$R=self.$R||{})["server-fn:0"]=[],($R=>$R[0]={mine:!0,useBalance:!1,region:$R[1]=["us","eu","sg","cn"],rollingUsage:$R[2]={status:"ok",resetInSec:10766,usagePercent:3},weeklyUsage:$R[3]={status:"ok",resetInSec:444242,usagePercent:9},monthlyUsage:$R[4]={status:"ok",resetInSec:2421543,usagePercent:34}})($R["server-fn:0"]))`

describe("browser-session transport", () => {
  test("decodes a seroval server function body", () => {
    const value = decodeServerFunctionBody(USAGE_BODY) as Record<string, unknown>
    expect(value).toEqual({
      mine: true,
      useBalance: false,
      region: ["us", "eu", "sg", "cn"],
      rollingUsage: { status: "ok", resetInSec: 10766, usagePercent: 3 },
      weeklyUsage: { status: "ok", resetInSec: 444242, usagePercent: 9 },
      monthlyUsage: { status: "ok", resetInSec: 2421543, usagePercent: 34 },
    })
  })

  test("decodes a seroval body without a frame header", () => {
    const payload = USAGE_BODY.replace(/^;0x[0-9a-f]+;/, "")
    const value = decodeServerFunctionBody(payload) as Record<string, unknown>
    expect(value).toEqual({
      mine: true,
      useBalance: false,
      region: ["us", "eu", "sg", "cn"],
      rollingUsage: { status: "ok", resetInSec: 10766, usagePercent: 3 },
      weeklyUsage: { status: "ok", resetInSec: 444242, usagePercent: 9 },
      monthlyUsage: { status: "ok", resetInSec: 2421543, usagePercent: 34 },
    })
  })

  test("builds the replay url with json args", () => {
    const url = replayUrl("https://opencode.test", "a".repeat(64), ["wrk_123"])
    expect(url).toBe(
      `https://opencode.test/_server?id=${encodeURIComponent("a".repeat(64))}&args=${encodeURIComponent(JSON.stringify(["wrk_123"]))}`,
    )
  })

  test("extracts the target server function id from a bundle", () => {
    const bundle = [
      `const createLiteCheckoutUrl_action = createServerReference("${"b".repeat(64)}");`,
      `const createLiteCheckoutUrl = action(createLiteCheckoutUrl_action, "liteCheckoutUrl");`,
      `const queryLiteSubscription_query = createServerReference("${"c".repeat(64)}");`,
      `const queryLiteSubscription = query(queryLiteSubscription_query, "lite.subscription.get");`,
      `const setLiteUseBalance_action = createServerReference("${"d".repeat(64)}");`,
    ].join("\n")

    expect(serverFunctionId(bundle, "lite.subscription.get")).toBe("c".repeat(64))
  })

  test("returns undefined when the name is absent from the bundle", () => {
    const bundle = `const queryX = createServerReference("${"a".repeat(64)}");`
    expect(serverFunctionId(bundle, "lite.subscription.get")).toBeUndefined()
  })

  test("extracts js asset urls from html", () => {
    const html = [
      `<script type="module" src="/_build/assets/app.js"></script>`,
      `<link rel="modulepreload" href="/_build/assets/lib.js">`,
      `<link rel="stylesheet" href="/_build/assets/app.css">`,
      `<script src="https://cdn.example.com/remote.js"></script>`,
    ].join("")
    expect(assetUrls(html)).toEqual(["/_build/assets/app.js", "/_build/assets/lib.js", "https://cdn.example.com/remote.js"])
  })
})
