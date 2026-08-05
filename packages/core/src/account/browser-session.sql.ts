import { sqliteTable, text } from "drizzle-orm/sqlite-core"

import { Timestamps } from "../database/schema.sql"

export const BrowserSessionTable = sqliteTable("browser_session", {
  server_url: text().primaryKey(),
  cookie: text().notNull(),
  workspace_id: text(),
  hashes: text(),
  ...Timestamps,
})
