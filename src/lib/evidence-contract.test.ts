import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVIDENCE_FIELD_CONTRACT,
  EVIDENCE_FIELD_UNIT_CAP,
  EVIDENCE_NEVER_ADMITTED,
  EVIDENCE_REF_ENUM_BYTES,
  EVIDENCE_UNIT_CHAR_LIMIT,
  evidenceBudgetBytes,
} from "./custodian-evidence-contract";
import { OWNER_READONLY_CEILINGS } from "./custodian-owner-start";

const root = join(import.meta.dir, "..", "..");
const migration = readFileSync(
  join(root, "supabase/migrations/20261014120000_custodian_source_backed_analysis.sql"),
  "utf8",
);
const caseReading = readFileSync(join(root, "src/lib/case-reading.ts"), "utf8");

/** Pulls `when 'type' then '[...]'::jsonb` field specs out of the builder. */
function sqlSpec(recordType: string): Array<{ key: string; code: string }> {
  const match = new RegExp(`when '${recordType}' then '\\[([\\s\\S]*?)\\]'::jsonb`).exec(migration);
  if (!match) throw new Error(`no SQL field spec for ${recordType}`);
  return [...match[1].matchAll(/\["([A-Za-z]+)","([a-z])"/g)].map((entry) => ({
    key: entry[1],
    code: entry[2],
  }));
}

describe("shared evidence contract", () => {
  for (const [recordType, fields] of Object.entries(EVIDENCE_FIELD_CONTRACT)) {
    test(`the SQL snapshot builder admits exactly the contract fields for ${recordType}`, () => {
      expect(sqlSpec(recordType)).toEqual([...fields]);
    });

    test(`Case Reading projects every contract field for ${recordType}`, () => {
      for (const { key } of fields) {
        expect(caseReading.includes(`data.${key}`)).toBe(true);
      }
    });

    test(`field codes are unique within ${recordType}`, () => {
      const codes = fields.map((field) => field.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.includes("s")).toBe(false); // "s" is reserved for the record summary
    });
  }

  test("raw transcripts and storage paths are never part of the contract", () => {
    const admitted = Object.values(EVIDENCE_FIELD_CONTRACT).flatMap((fields) =>
      fields.map((field) => field.key),
    );
    for (const key of EVIDENCE_NEVER_ADMITTED) {
      expect(admitted.includes(key)).toBe(false);
    }
    // Storage paths are only type-checked to label the original text state, never copied.
    expect(/'text',\s*data ->> '(storagePath|extractedContentPath)'/.test(migration)).toBe(false);
    // rawConversationText may be measured for its length, never copied into a unit.
    expect(migration.includes("data ->> 'rawConversationText'")).toBe(true);
    expect(/'text',\s*data ->> 'rawConversationText'/.test(migration)).toBe(false);
  });

  test("SQL bounds match the contract constants", () => {
    expect(
      migration.includes(`unit_char_limit constant integer := ${EVIDENCE_UNIT_CHAR_LIMIT};`),
    ).toBe(true);
    expect(
      migration.includes(`field_unit_cap constant integer := ${EVIDENCE_FIELD_UNIT_CAP};`),
    ).toBe(true);
    expect(
      migration.includes(`ref_enum_cost constant integer := ${EVIDENCE_REF_ENUM_BYTES};`),
    ).toBe(true);
  });

  test("the budget formula in SQL matches the TypeScript mirror and the product ceiling", () => {
    expect(migration.includes("- 4096 - 10500")).toBe(true);
    expect(migration.includes("* 100 / 115.0")).toBe(true);
    // Product default: the evidence that fits is small and must stay visible, not silently assumed.
    const budget = evidenceBudgetBytes(OWNER_READONLY_CEILINGS.perRunTokenBudget, 200);
    expect(OWNER_READONLY_CEILINGS.perRunTokenBudget).toBe(40_000);
    expect(budget).toBeGreaterThan(20_000);
    expect(evidenceBudgetBytes(80_000, 200)).toBeGreaterThan(budget * 1.8);
    expect(evidenceBudgetBytes(1_000, 200)).toBe(0);
  });
});
