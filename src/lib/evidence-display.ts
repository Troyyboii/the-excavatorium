import type { JsonValue } from "./custodian-types";

export const EVIDENCE_DISPLAY_MAX_DEPTH = 4;
export const EVIDENCE_DISPLAY_MAX_CHARACTERS = 20_000;
export const EVIDENCE_DISPLAY_MAX_ENTRIES = 4_096;

type DisplayBudget = {
  remaining: number;
  entriesRemaining: number;
  truncated: boolean;
};

function consumeEntry(budget: DisplayBudget): boolean {
  if (budget.entriesRemaining <= 0) {
    budget.truncated = true;
    return false;
  }
  budget.entriesRemaining -= 1;
  return true;
}

function boundedJsonValue(value: JsonValue, depth: number, budget: DisplayBudget): JsonValue {
  if (!consumeEntry(budget) || budget.remaining <= 0) {
    budget.truncated = true;
    return "[content truncated]";
  }
  if (typeof value === "string") {
    if (value.length <= budget.remaining) {
      budget.remaining -= value.length;
      return value;
    }
    budget.truncated = true;
    const visibleLength = Math.max(0, budget.remaining - 1);
    budget.remaining = 0;
    return `${value.slice(0, visibleLength)}…`;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= EVIDENCE_DISPLAY_MAX_DEPTH) {
    budget.truncated = true;
    return "[nested content truncated]";
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const entry of value) {
      if (budget.entriesRemaining <= 0 || budget.remaining <= 0) {
        budget.truncated = true;
        result.push("[content truncated]");
        break;
      }
      result.push(boundedJsonValue(entry, depth + 1, budget));
    }
    return result;
  }
  const result: { [key: string]: JsonValue } = Object.create(null) as {
    [key: string]: JsonValue;
  };
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (budget.entriesRemaining <= 0 || budget.remaining <= 0) {
      budget.truncated = true;
      result["[content truncated]"] = true;
      break;
    }
    result[key] = boundedJsonValue(value[key], depth + 1, budget);
  }
  return result;
}

export function formatEvidenceContent(value: JsonValue): { text: string; truncated: boolean } {
  const budget: DisplayBudget = {
    remaining: EVIDENCE_DISPLAY_MAX_CHARACTERS,
    entriesRemaining: EVIDENCE_DISPLAY_MAX_ENTRIES,
    truncated: false,
  };
  if (typeof value === "string") {
    const bounded = boundedJsonValue(value, 0, budget);
    return { text: String(bounded), truncated: budget.truncated };
  }
  const bounded = boundedJsonValue(value, 0, budget);
  const serialized = JSON.stringify(bounded, null, 2) ?? String(bounded);
  if (serialized.length <= EVIDENCE_DISPLAY_MAX_CHARACTERS) {
    return { text: serialized, truncated: budget.truncated };
  }
  return {
    text: `${serialized.slice(0, EVIDENCE_DISPLAY_MAX_CHARACTERS - 1)}…`,
    truncated: true,
  };
}
