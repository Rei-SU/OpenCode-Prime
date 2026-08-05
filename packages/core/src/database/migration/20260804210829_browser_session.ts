import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260804210829_browser_session",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`browser_session\` (
          \`server_url\` text PRIMARY KEY,
          \`cookie\` text NOT NULL,
          \`workspace_id\` text,
          \`hashes\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
