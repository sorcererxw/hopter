import { describe, expect, test } from "bun:test"

import {
  applyAtomicSkillDeletion,
  normalizeAtomicSkillSelection,
} from "../ui/src/components/app/sessions/composer/skill-token.ts"

const skills = new Set(["office-hours", "autopilot"])

describe("session composer skill token editing", () => {
  test("expands partial cursor selection to the whole skill token", () => {
    expect(
      normalizeAtomicSkillSelection("$office-hours asdaasd", 2, 6, skills)
    ).toEqual({
      changed: true,
      start: 0,
      end: "$office-hours".length,
    })
  })

  test("selects the whole skill token when cursor lands inside it", () => {
    expect(
      normalizeAtomicSkillSelection("$office-hours asdaasd", 5, 5, skills)
    ).toEqual({
      changed: true,
      start: 0,
      end: "$office-hours".length,
    })
  })

  test("does not expand unknown dollar words", () => {
    expect(
      normalizeAtomicSkillSelection("$unknown asdaasd", 2, 6, skills)
    ).toEqual({
      changed: false,
      start: 2,
      end: 6,
    })
  })

  test("backspace removes the whole skill token and trailing separator", () => {
    expect(
      applyAtomicSkillDeletion(
        "$office-hours asdaasd",
        "$office-hours".length,
        "$office-hours".length,
        "Backspace",
        skills
      )
    ).toEqual({
      selectionEnd: 0,
      selectionStart: 0,
      value: "asdaasd",
    })
  })

  test("backspace removes a partially selected skill token atomically", () => {
    expect(
      applyAtomicSkillDeletion(
        "$office-hours asdaasd",
        2,
        6,
        "Backspace",
        skills
      )
    ).toEqual({
      selectionEnd: 0,
      selectionStart: 0,
      value: "asdaasd",
    })
  })
})
