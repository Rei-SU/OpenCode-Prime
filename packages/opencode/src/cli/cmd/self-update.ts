import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { UPDATE_REPO } from "../../installation"
import { installArtifact } from "../../installation/artifact"
import { UI } from "../ui"

const APP = "opencode-prime"

export const SelfUpdateCommand = {
  command: "self-update",
  describe: "update opencode-prime to the latest release from GitHub",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Self-update")

    try {
      prompts.log.info("Downloading the latest release")
      const result = await installArtifact({ repo: UPDATE_REPO })
      if (!result.changed) {
        prompts.log.info(`Already up to date (${result.version})`)
        prompts.outro("Done")
        return
      }

      if (process.platform === "win32") {
        prompts.log.success(
          `Downloaded ${result.version}. It will be applied when this session exits — run ${APP} again to use it.`,
        )
      } else {
        prompts.log.success(`Updated to ${result.version}`)
      }
    } catch (err) {
      prompts.log.error(err instanceof Error ? err.message : String(err))
    }
    prompts.outro("Done")
  },
}
