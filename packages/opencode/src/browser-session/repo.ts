import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BrowserSessionTable } from "@opencode-ai/core/account/browser-session.sql"
import { Database } from "@opencode-ai/core/database/database"
import { desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"

import { BrowserSessionError } from "./schema"

export type SessionRow = (typeof BrowserSessionTable)["$inferSelect"]

export function decodeHashes(row: SessionRow): Record<string, string> {
  if (!row.hashes) return {}
  try {
    const parsed = JSON.parse(row.hashes)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function encodeHashes(hashes: Record<string, string>): string | null {
  const entries = Object.entries(hashes).filter(([, hash]) => hash.length > 0)
  return entries.length === 0 ? null : JSON.stringify(Object.fromEntries(entries))
}

function fromUndefined<A>(value: A | undefined): Option.Option<A> {
  return value === undefined ? Option.none() : Option.some(value)
}

export interface Interface {
  readonly get: () => Effect.Effect<Option.Option<SessionRow>, BrowserSessionError>
  readonly getByServerUrl: (serverUrl: string) => Effect.Effect<Option.Option<SessionRow>, BrowserSessionError>
  readonly upsert: (input: {
    serverUrl: string
    cookie: string
    workspaceId?: string
    hashes?: Record<string, string>
  }) => Effect.Effect<void, BrowserSessionError>
  readonly remove: (serverUrl: string) => Effect.Effect<void, BrowserSessionError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserSessionRepo") {}

const layer: Layer.Layer<Service, never, Database.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const mapError = (message: string) => (cause: unknown) =>
      new BrowserSessionError({ message, kind: "database", cause })

    const get = Effect.fn("BrowserSessionRepo.get")(() =>
      db
        .select()
        .from(BrowserSessionTable)
        .orderBy(desc(BrowserSessionTable.time_updated))
        .limit(1)
        .get()
        .pipe(
          Effect.map(fromUndefined),
          Effect.mapError(mapError("Failed to read browser session")),
        ),
    )

    const getByServerUrl = Effect.fn("BrowserSessionRepo.getByServerUrl")((serverUrl: string) =>
      db
        .select()
        .from(BrowserSessionTable)
        .where(eq(BrowserSessionTable.server_url, serverUrl))
        .get()
        .pipe(
          Effect.map(fromUndefined),
          Effect.mapError(mapError("Failed to read browser session")),
        ),
    )

    const upsert = Effect.fn("BrowserSessionRepo.upsert")((input: {
      serverUrl: string
      cookie: string
      workspaceId?: string
      hashes?: Record<string, string>
    }) =>
      db
        .insert(BrowserSessionTable)
        .values({
          server_url: input.serverUrl,
          cookie: input.cookie,
          workspace_id: input.workspaceId ?? null,
          hashes: input.hashes ? encodeHashes(input.hashes) : null,
        })
        .onConflictDoUpdate({
          target: BrowserSessionTable.server_url,
          set: {
            cookie: input.cookie,
            workspace_id: input.workspaceId ?? null,
            hashes: input.hashes ? encodeHashes(input.hashes) : null,
          },
        })
        .run()
        .pipe(
          Effect.asVoid,
          Effect.mapError(mapError("Failed to store browser session")),
        ),
    )

    const remove = Effect.fn("BrowserSessionRepo.remove")((serverUrl: string) =>
      db
        .delete(BrowserSessionTable)
        .where(eq(BrowserSessionTable.server_url, serverUrl))
        .run()
        .pipe(
          Effect.asVoid,
          Effect.mapError(mapError("Failed to remove browser session")),
        ),
    )

    return Service.of({ get, getByServerUrl, upsert, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Database.node] })

export * as BrowserSessionRepo from "./repo"
