import { primeLogo } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmark(pad = "") {
  const bright = "\x1b[97m"
  return primeLogo.right.map((line) => (line ? `${pad}${bright}${line}${reset}` : ""))
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}opencode-prime -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
