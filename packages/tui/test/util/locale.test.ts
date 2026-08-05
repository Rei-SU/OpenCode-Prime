import { describe, expect, test } from "bun:test"
import { number } from "../../src/util/locale"

describe("Locale.number", () => {
  test("formats thousands compactly", () => {
    expect(number(0)).toBe("0")
    expect(number(999)).toBe("999")
    expect(number(1_000)).toBe("1k")
    expect(number(12_000)).toBe("12k")
    expect(number(18_114)).toBe("18.1k")
    expect(number(200_000)).toBe("200k")
    expect(number(999_900)).toBe("999.9k")
    expect(number(999_999)).toBe("1M")
  })

  test("formats millions compactly", () => {
    expect(number(1_000_000)).toBe("1M")
    expect(number(1_500_000)).toBe("1.5M")
    expect(number(200_000_000)).toBe("200M")
  })
})
