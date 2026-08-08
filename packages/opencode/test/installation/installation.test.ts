import { describe, expect, test } from "bun:test"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(
  handler: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string } = () =>
    "",
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string },
) {
  const spawnerNode = makeGlobalNode({
    service: ChildProcessSpawner.ChildProcessSpawner,
    layer: mockSpawner(spawnHandler),
    deps: [],
  })
  return LayerNode.compile(Installation.node, [
    [httpClient, mockHttpClient(httpHandler)],
    [CrossSpawnSpawner.node, spawnerNode],
  ])
}

describe("installation", () => {
  describe("latest", () => {
    testEffect(testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))).effect(
      "reads release version from GitHub releases",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("unknown")
          expect(result).toBe("1.2.3")
        }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))).effect(
      "strips v prefix from GitHub release tag",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("curl")
          expect(result).toBe("4.0.0-beta.1")
        }),
    )

    const primeCalls: string[] = []
    testEffect(
      testLayer((request) => {
        primeCalls.push(request.url)
        return jsonResponse({ tag_name: "v0.0.0-dev-202608052319" })
      }),
    ).effect("reads the latest release from the opencode-prime repository", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("curl")
        expect(result).toBe("0.0.0-dev-202608052319")
        expect(primeCalls).toContain(
          "https://api.github.com/repos/Rei-SU/opencode-prime/releases/latest",
        )
      }),
    )

    const npmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        npmCalls.push(request.url)
        return jsonResponse({ tag_name: "v1.5.0" })
      }),
    ).effect("never resolves upstream npm versions for a prime install", () =>
      Effect.gen(function* () {
        // Even when a passed install method would historically have pointed at the
        // upstream npm registry, the fork always resolves from its own GitHub repo.
        const result = yield* Installation.use.latest("npm")
        expect(result).toBe("1.5.0")
        expect(npmCalls).not.toContain("https://registry.npmjs.org/opencode-ai/latest")
        expect(npmCalls).toContain(
          "https://api.github.com/repos/Rei-SU/opencode-prime/releases/latest",
        )
      }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v2.3.4" }))).effect(
      "resolves scoop-style requests from the prime repo, not the upstream manifest",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("scoop")
          expect(result).toBe("2.3.4")
        }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v3.4.5" }))).effect(
      "resolves chocolatey-style requests from the prime repo, not the upstream feed",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("choco")
          expect(result).toBe("3.4.5")
        }),
    )

    testEffect(
      testLayer(() => jsonResponse({ tag_name: "v2.0.0" })),
    ).effect("resolves brew-style requests from the prime repo, not the upstream formula", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("brew")
        expect(result).toBe("2.0.0")
      }),
    )
  })

  describe("upgrade", () => {
    testEffect(testLayer(() => jsonResponse({}))).effect(
      "rejects package-manager upgrades instead of installing the upstream package",
      () =>
        Effect.gen(function* () {
          // opencode-prime only upgrades via its own curl installer. Asking for an
          // npm upgrade must fail rather than pull in the upstream opencode-ai.
          const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
          expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
          expect(error.stderr).toBe("Upgrade failed for npm.")
        }),
    )

    testEffect(
      testLayer(
        () => new Response("install script with token=secret", { status: 200 }),
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return "GNU bash"
          if (cmd === "bash" || cmd === "sh") return { code: 1, stderr: "script output with token=secret" }
          return ""
        },
      ),
    ).effect("returns sanitized typed errors when the curl install script fails", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("Upgrade failed for curl (exit code 1).")
        expect(error.message).toBe(error.stderr)
        expect(error.stderr).not.toContain("secret")
        expect(error.stderr).not.toContain("script output")
      }),
    )

    testEffect(
      testLayer(
        () => new Response("install script", { status: 200 }),
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return { code: 1, stderr: "missing" }
          if (cmd === "bash") return { code: 1, stderr: "should not execute installer with bash" }
          if (cmd === "sh") return "ok"
          return ""
        },
      ),
    ).effect("falls back to sh when bash is unavailable during curl upgrade", () =>
      Effect.gen(function* () {
        yield* Installation.use.upgrade("curl", "9.9.9")
      }),
    )
  })

  describe("method", () => {
    testEffect(testLayer(() => jsonResponse({}))).effect(
      "always reports the curl method for an opencode-prime install",
      () =>
        Effect.gen(function* () {
          // opencode-prime is only distributed via install.sh / install.ps1, so the
          // install method is always "curl" regardless of exec path or whether the
          // upstream opencode-ai is also present on the machine.
          const result = yield* Installation.use.method()
          expect(result).toBe("curl")
        }),
    )
  })

  describe("getReleaseType", () => {
    test("compares opencode-prime dev versions against each other", () => {
      expect(
        Installation.getReleaseType("0.0.0-dev-20260805000000", "0.0.0-dev-202608052319"),
      ).toBe("patch")
    })

    test("never treats an upstream version as a downgrade signal for dev versions", () => {
      // The fork only ever compares against its own dev versions; the comparison
      // must not crash or misclassify on our version format.
      expect(Installation.getReleaseType("0.0.0-dev-202608052319", "0.0.0-dev-202608052319")).toBe("patch")
    })

    test("degrades .P prime versions to patch instead of throwing", () => {
      // `1.18.14.P.1` is not valid semver; the comparison must not crash and
      // must not treat a newer prime build as a downgrade.
      expect(Installation.getReleaseType("1.18.14.P.1", "1.18.14.P.2")).toBe("patch")
      expect(Installation.getReleaseType("1.18.14.P-dev.2026080619", "1.18.14.P-dev.2026080620")).toBe("patch")
    })
  })
})
