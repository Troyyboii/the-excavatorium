import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  defaultModelForTier,
  isOpenAiModelId,
  OPENAI_MODEL_IDS,
  OPENAI_MODELS,
  openAiModelTier,
} from "./openai-models";
import { MODEL_ALLOWLIST } from "./custodian-runtime-types";
import * as edge from "../../supabase/functions/_shared/openai-models";

const root = join(import.meta.dir, "..", "..");

describe("OpenAI model catalog", () => {
  test("is exactly the six approved model IDs", () => {
    expect([...OPENAI_MODEL_IDS].sort()).toEqual(
      [
        "gpt-5.6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
        "gpt-6-luna",
        "gpt-6-sol",
        "gpt-6-astra",
      ].sort(),
    );
  });

  test("rejects retired and foreign models", () => {
    for (const value of ["gpt-5.6-pro", "gpt-4o", "", null, undefined, 3, "GPT-6-ASTRA"]) {
      expect(isOpenAiModelId(value)).toBe(false);
    }
    expect(openAiModelTier("gpt-5.6-pro")).toBeNull();
  });

  test("browser and Edge catalogs are identical", () => {
    expect(OPENAI_MODELS).toEqual(edge.OPENAI_MODELS as unknown as typeof OPENAI_MODELS);
  });

  test("tier defaults are derived from the catalog, not scattered literals", () => {
    expect(MODEL_ALLOWLIST.luna).toBe(defaultModelForTier("luna"));
    expect(MODEL_ALLOWLIST.pro).toBe("gpt-6-astra");
  });

  test("the SQL catalog function matches the TypeScript catalog", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/20260924110000_custodian_openai_model_catalog.sql"),
      "utf8",
    );
    const fn = sql.slice(
      sql.indexOf("create or replace function public.custodian_openai_model_tier"),
    );
    const body = fn.slice(0, fn.indexOf("$$;", fn.indexOf("as $$") + 5));
    const pairs = [...body.matchAll(/when '([^']+)' then '([^']+)'/g)].map((m) => [m[1], m[2]]);
    expect(pairs).toEqual(OPENAI_MODELS.map((m) => [m.id, m.tier]));
  });

  test("no other source file hard-codes a selectable model ID", () => {
    const allowed = new Set([
      "src/lib/openai-models.ts",
      "supabase/functions/_shared/openai-models.ts",
      // Not Custodian: these server-key extraction paths keep their own model
      // literals until the operator-cost decision in docs/public-readiness.md.
      "supabase/functions/conversation-extract/index.ts",
      "supabase/functions/document-extract/index.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const rel = full.slice(root.length + 1).replaceAll("\\", "/");
          if (allowed.has(rel)) continue;
          if (/gpt-(5\.6|6)-[a-z]+/.test(readFileSync(full, "utf8"))) offenders.push(rel);
        }
      }
    };
    walk(join(root, "src"));
    walk(join(root, "supabase/functions"));
    expect(offenders).toEqual([]);
  });
});
