import type { ArchiveRecord, RecordType } from "./types";
import { CASE_READING_MAX_CHARS, type CaseArchiveScope } from "./custodian-types";

const FIELD_MAX_CHARS = 4_000;
const MIN_FITTED_RECORD_CHARS = 600;

export type CaseReadingField = {
  label: string;
  value: string;
};

export type CaseReadingRecord = {
  recordId: string;
  recordType: RecordType;
  title: string;
  summary: string;
  fields: CaseReadingField[];
  provenance: string[];
  truncatedFields: string[];
  omittedFields: string[];
};

export type CaseReadingSignal = {
  recordId: string;
  message: string;
};

export type CaseReadingBundle = {
  selectedRecordIds: string[];
  ownerContext: string;
  includedRecords: CaseReadingRecord[];
  excludedRecords: { recordId: string; reason: "unavailable" | "reading_limit" }[];
  serializedChars: number;
  truncation: {
    occurred: boolean;
    omittedRecordIds: string[];
    omittedSignalCounts: Array<{
      recordId: string;
      superseded: number;
      conflicts: number;
      uncertainties: number;
    }>;
    omittedEvidenceGapCount: number;
    ownerContextTruncated: boolean;
    reason: string | null;
  };
  supersededMaterial: CaseReadingSignal[];
  conflictSignals: CaseReadingSignal[];
  uncertaintySignals: CaseReadingSignal[];
  evidenceGaps: string[];
};

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function boundedText(value: unknown, max = FIELD_MAX_CHARS): { value: string; truncated: boolean } {
  const text = textValue(value);
  if (text.length <= max) return { value: text, truncated: false };
  return { value: `${text.slice(0, Math.max(0, max - 1))}…`, truncated: true };
}

function pushField(
  fields: CaseReadingField[],
  truncatedFields: string[],
  label: string,
  value: unknown,
) {
  const bounded = boundedText(value);
  if (!bounded.value.trim()) return;
  fields.push({ label, value: bounded.value });
  if (bounded.truncated) truncatedFields.push(label);
}

function projectRecord(record: ArchiveRecord): CaseReadingRecord {
  const fields: CaseReadingField[] = [];
  const truncatedFields: string[] = [];
  const provenance = [
    `Archive record ID: ${record.id}`,
    `Record type: ${record.recordType}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
  ];

  const summary = boundedText(record.summary);
  if (summary.truncated) truncatedFields.push("Summary");
  if (record.tags.length) pushField(fields, truncatedFields, "Tags", record.tags.join(", "));

  switch (record.recordType) {
    case "tool": {
      const data = record.recordData;
      pushField(fields, truncatedFields, "Category", data.category);
      pushField(fields, truncatedFields, "Status", data.status);
      pushField(fields, truncatedFields, "What caught my eye", data.whatCaughtMyEye);
      pushField(fields, truncatedFields, "What it promised", data.whatItPromised);
      pushField(fields, truncatedFields, "What actually happened", data.whatActuallyHappened);
      pushField(fields, truncatedFields, "What worked", data.whatWorked);
      pushField(fields, truncatedFields, "What failed", data.whatFailed);
      pushField(
        fields,
        truncatedFields,
        "Why I kept or stopped using it",
        data.whyIKeptOrStoppedUsingIt,
      );
      pushField(fields, truncatedFields, "Replacement tool ID", data.replacementToolId);
      pushField(fields, truncatedFields, "Revisit condition", data.revisitCondition);
      pushField(fields, truncatedFields, "Final verdict", data.finalVerdict);
      pushField(fields, truncatedFields, "Last reviewed", data.lastReviewed);
      break;
    }
    case "repository": {
      const data = record.recordData;
      pushField(fields, truncatedFields, "GitHub URL", data.githubUrl);
      pushField(fields, truncatedFields, "What caught my eye", data.whatCaughtMyEye);
      pushField(fields, truncatedFields, "What it claims", data.whatItClaims);
      pushField(fields, truncatedFields, "What it actually does", data.whatItActuallyDoes);
      pushField(fields, truncatedFields, "Maintenance impression", data.maintenanceImpression);
      pushField(fields, truncatedFields, "Complexity", data.complexity);
      pushField(fields, truncatedFields, "Risk", data.risk);
      pushField(fields, truncatedFields, "Integration cost", data.integrationCost);
      pushField(fields, truncatedFields, "Immediate usefulness", data.immediateUsefulness);
      pushField(fields, truncatedFields, "Long-term value", data.longTermValue);
      pushField(fields, truncatedFields, "Recommended action", data.recommendedAction);
      pushField(fields, truncatedFields, "Final verdict", data.finalVerdict);
      pushField(fields, truncatedFields, "Last reviewed", data.lastReviewed);
      break;
    }
    case "conversation": {
      const data = record.recordData;
      pushField(fields, truncatedFields, "Conversation date", data.conversationDate);
      pushField(fields, truncatedFields, "Project route", data.projectRoute);
      pushField(fields, truncatedFields, "High-signal findings", data.highSignalFindings);
      pushField(fields, truncatedFields, "Decisions made", data.decisionsMade);
      pushField(fields, truncatedFields, "Open loops", data.openLoops);
      pushField(fields, truncatedFields, "Reusable prompts", data.reusablePrompts);
      pushField(fields, truncatedFields, "Memory candidates", data.memoryCandidates);
      break;
    }
    case "decision": {
      const data = record.recordData;
      pushField(fields, truncatedFields, "Reason", data.reason);
      pushField(fields, truncatedFields, "Trigger", data.trigger);
      pushField(fields, truncatedFields, "What would change my mind", data.whatWouldChangeMyMind);
      pushField(fields, truncatedFields, "Decision date", data.decisionDate);
      pushField(fields, truncatedFields, "Status", data.status);
      pushField(fields, truncatedFields, "Confidence", data.confidence);
      pushField(fields, truncatedFields, "Supersedes decision ID", data.supersedesDecisionId);
      break;
    }
    case "document": {
      const data = record.recordData;
      pushField(fields, truncatedFields, "Original file name", data.originalFileName);
      pushField(fields, truncatedFields, "Document date", data.documentDate);
      pushField(fields, truncatedFields, "Page count", data.pageCount);
      pushField(fields, truncatedFields, "High-signal findings", data.highSignalFindings);
      pushField(fields, truncatedFields, "Key claims", data.keyClaims);
      pushField(fields, truncatedFields, "Contradictions", data.contradictions);
      pushField(fields, truncatedFields, "Uncertainties", data.uncertainties);
      for (const reference of data.sourceReferences) {
        const referenceText = [reference.label, reference.locator, reference.note]
          .filter(Boolean)
          .join(" · ");
        if (referenceText) provenance.push(`Document source: ${referenceText}`);
      }
      break;
    }
  }

  return {
    recordId: record.id,
    recordType: record.recordType,
    title: record.title,
    summary: summary.value,
    fields,
    provenance,
    truncatedFields,
    omittedFields: [],
  };
}

function fitRecordToBudget(record: CaseReadingRecord, budget: number): CaseReadingRecord | null {
  if (budget < MIN_FITTED_RECORD_CHARS) return null;

  const candidate: CaseReadingRecord = {
    recordId: record.recordId,
    recordType: record.recordType,
    title: record.title,
    summary: "",
    fields: [],
    provenance: [],
    truncatedFields: [...record.truncatedFields],
    omittedFields: [...record.omittedFields],
  };

  function appendText(kind: "summary" | "field" | "provenance", label: string, fullText: string) {
    if (!fullText) return;
    const makeCandidate = (value: string): CaseReadingRecord => {
      if (kind === "summary") return { ...candidate, summary: value };
      if (kind === "provenance") {
        return { ...candidate, provenance: [...candidate.provenance, value] };
      }
      return { ...candidate, fields: [...candidate.fields, { label, value }] };
    };

    const fullCandidate = makeCandidate(fullText);
    if (JSON.stringify(fullCandidate).length <= budget) {
      if (kind === "summary") candidate.summary = fullText;
      else if (kind === "provenance") candidate.provenance.push(fullText);
      else candidate.fields.push({ label, value: fullText });
      return;
    }

    let low = 1;
    let high = fullText.length;
    let best = "";
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const value = `${fullText.slice(0, Math.max(0, middle - 1))}…`;
      if (JSON.stringify(makeCandidate(value)).length <= budget) {
        best = value;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (!best) {
      if (!candidate.omittedFields.includes(label)) candidate.omittedFields.push(label);
      return;
    }
    if (kind === "summary") candidate.summary = best;
    else if (kind === "provenance") candidate.provenance.push(best);
    else candidate.fields.push({ label, value: best });
    if (!candidate.truncatedFields.includes(label)) candidate.truncatedFields.push(label);
  }

  appendText("summary", "Summary", record.summary);
  for (const field of record.fields) appendText("field", field.label, field.value);
  for (const [index, provenance] of record.provenance.entries()) {
    appendText("provenance", `Provenance ${index + 1}`, provenance);
  }

  return JSON.stringify(candidate).length <= budget ? candidate : null;
}

function signalsForRecord(record: ArchiveRecord): {
  supersededMaterial: CaseReadingSignal[];
  conflictSignals: CaseReadingSignal[];
  uncertaintySignals: CaseReadingSignal[];
  evidenceGaps: string[];
} {
  const supersededMaterial: CaseReadingSignal[] = [];
  const conflictSignals: CaseReadingSignal[] = [];
  const uncertaintySignals: CaseReadingSignal[] = [];
  const evidenceGaps: string[] = [];

  if (record.recordType === "decision") {
    const data = record.recordData;
    if (data.status === "Superseded" || data.status === "Reversed") {
      supersededMaterial.push({
        recordId: record.id,
        message: `Canonical Decision status is ${data.status}.`,
      });
    }
    if (data.supersedesDecisionId) {
      supersededMaterial.push({
        recordId: record.id,
        message: `Explicitly supersedes archive record ${data.supersedesDecisionId}.`,
      });
    }
  }

  if (record.recordType === "tool" && record.recordData.replacementToolId) {
    supersededMaterial.push({
      recordId: record.id,
      message: `Explicitly references replacement tool ${record.recordData.replacementToolId}.`,
    });
  }

  if (record.recordType === "document") {
    const data = record.recordData;
    for (const item of data.contradictions) {
      conflictSignals.push({
        recordId: record.id,
        message: item.text || "The Document contains an explicit contradiction annotation.",
      });
    }
    for (const item of data.uncertainties) {
      uncertaintySignals.push({
        recordId: record.id,
        message: item.text || "The Document contains an explicit uncertainty annotation.",
      });
    }
  }

  return { supersededMaterial, conflictSignals, uncertaintySignals, evidenceGaps };
}

type CaseReadingBundleParts = Omit<CaseReadingBundle, "serializedChars">;

const TRUNCATION_REASON = `Case Reading serialized bundle is bounded at ${CASE_READING_MAX_CHARS.toLocaleString()} characters.`;

function finalizeBundle(parts: CaseReadingBundleParts): CaseReadingBundle {
  let serializedChars = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bundle: CaseReadingBundle = { ...parts, serializedChars };
    const nextSerializedChars = JSON.stringify(bundle).length;
    if (nextSerializedChars === serializedChars) return bundle;
    serializedChars = nextSerializedChars;
  }
  const bundle: CaseReadingBundle = { ...parts, serializedChars };
  return { ...bundle, serializedChars: JSON.stringify(bundle).length };
}

function bundleSize(parts: CaseReadingBundleParts): number {
  return finalizeBundle(parts).serializedChars;
}

function markTruncation(parts: CaseReadingBundleParts) {
  parts.truncation.occurred = true;
  parts.truncation.reason = TRUNCATION_REASON;
}

function recordOmittedSignal(
  parts: CaseReadingBundleParts,
  signal: CaseReadingSignal,
  category: "superseded" | "conflicts" | "uncertainties",
) {
  let counts = parts.truncation.omittedSignalCounts.find(
    (item) => item.recordId === signal.recordId,
  );
  if (!counts) {
    counts = { recordId: signal.recordId, superseded: 0, conflicts: 0, uncertainties: 0 };
    parts.truncation.omittedSignalCounts.push(counts);
  }
  counts[category] += 1;
}

function compactSignals(parts: CaseReadingBundleParts) {
  const candidates: Array<
    [
      "supersededMaterial" | "conflictSignals" | "uncertaintySignals",
      "superseded" | "conflicts" | "uncertainties",
    ]
  > = [
    ["uncertaintySignals", "uncertainties"],
    ["conflictSignals", "conflicts"],
    ["supersededMaterial", "superseded"],
  ];

  while (bundleSize(parts) > CASE_READING_MAX_CHARS) {
    let removed = false;
    for (const [key, category] of candidates) {
      const signals = parts[key];
      const signal = signals.pop();
      if (!signal) continue;
      recordOmittedSignal(parts, signal, category);
      markTruncation(parts);
      removed = true;
      break;
    }
    if (!removed) return;
  }
}

function omitLastRecord(parts: CaseReadingBundleParts) {
  const record = parts.includedRecords.pop();
  if (!record) return;
  parts.excludedRecords.push({ recordId: record.recordId, reason: "reading_limit" });
  if (!parts.truncation.omittedRecordIds.includes(record.recordId)) {
    parts.truncation.omittedRecordIds.push(record.recordId);
  }
  markTruncation(parts);
}

function compactLastRecord(parts: CaseReadingBundleParts) {
  const record = parts.includedRecords.at(-1);
  if (!record) return;

  const retainedRecords = parts.includedRecords.slice(0, -1);
  const baseParts: CaseReadingBundleParts = {
    ...parts,
    includedRecords: retainedRecords,
    truncation: { ...parts.truncation, occurred: true, reason: TRUNCATION_REASON },
  };
  let budget = Math.max(
    0,
    CASE_READING_MAX_CHARS - bundleSize(baseParts) - (retainedRecords.length ? 1 : 0) - 8,
  );

  for (let attempt = 0; attempt < 5 && budget >= MIN_FITTED_RECORD_CHARS; attempt += 1) {
    const fitted = fitRecordToBudget(record, budget);
    if (!fitted) break;
    const candidate: CaseReadingBundleParts = {
      ...baseParts,
      includedRecords: [...retainedRecords, fitted],
    };
    const candidateSize = bundleSize(candidate);
    if (candidateSize <= CASE_READING_MAX_CHARS) {
      parts.includedRecords = candidate.includedRecords;
      markTruncation(parts);
      return;
    }
    budget = Math.max(0, budget - (candidateSize - CASE_READING_MAX_CHARS) - 1);
  }

  omitLastRecord(parts);
}

function compactEvidenceGaps(parts: CaseReadingBundleParts) {
  while (bundleSize(parts) > CASE_READING_MAX_CHARS && parts.evidenceGaps.length) {
    parts.evidenceGaps.pop();
    parts.truncation.omittedEvidenceGapCount += 1;
    markTruncation(parts);
  }
}

function compactOwnerContext(parts: CaseReadingBundleParts) {
  if (bundleSize(parts) <= CASE_READING_MAX_CHARS || !parts.ownerContext) return;

  const original = parts.ownerContext;
  let low = 0;
  let high = original.length;
  let best = "";
  parts.truncation.ownerContextTruncated = true;
  markTruncation(parts);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = middle === 0 ? "" : `${original.slice(0, Math.max(0, middle - 1))}…`;
    parts.ownerContext = candidate;
    if (bundleSize(parts) <= CASE_READING_MAX_CHARS) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  parts.ownerContext = best;
}

function compactToMinimalBundle(
  parts: CaseReadingBundleParts,
  availableRecordIds: readonly string[],
): CaseReadingBundleParts {
  for (const signal of parts.supersededMaterial) recordOmittedSignal(parts, signal, "superseded");
  for (const signal of parts.conflictSignals) recordOmittedSignal(parts, signal, "conflicts");
  for (const signal of parts.uncertaintySignals) {
    recordOmittedSignal(parts, signal, "uncertainties");
  }

  const excludedById = new Map(parts.excludedRecords.map((item) => [item.recordId, item]));
  for (const recordId of availableRecordIds) {
    excludedById.set(recordId, { recordId, reason: "reading_limit" });
  }

  return {
    ...parts,
    ownerContext: "",
    includedRecords: [],
    excludedRecords: [...excludedById.values()],
    supersededMaterial: [],
    conflictSignals: [],
    uncertaintySignals: [],
    evidenceGaps: [],
    truncation: {
      ...parts.truncation,
      occurred: true,
      omittedRecordIds: [...new Set([...parts.truncation.omittedRecordIds, ...availableRecordIds])],
      omittedEvidenceGapCount: parts.evidenceGaps.length + parts.truncation.omittedEvidenceGapCount,
      ownerContextTruncated: parts.truncation.ownerContextTruncated || Boolean(parts.ownerContext),
      reason: TRUNCATION_REASON,
    },
  };
}

export function buildCaseReadingBundle({
  scope,
  archiveRecords,
}: {
  scope: CaseArchiveScope;
  archiveRecords: readonly ArchiveRecord[];
}): CaseReadingBundle {
  const recordsById = new Map(archiveRecords.map((record) => [record.id, record]));
  const includedRecords: CaseReadingRecord[] = [];
  const excludedRecords: CaseReadingBundle["excludedRecords"] = [];
  const supersededMaterial: CaseReadingSignal[] = [];
  const conflictSignals: CaseReadingSignal[] = [];
  const uncertaintySignals: CaseReadingSignal[] = [];
  const evidenceGaps: string[] = [];
  const omittedRecordIds: string[] = [];

  for (const recordId of scope.recordIds) {
    const record = recordsById.get(recordId);
    if (!record) {
      excludedRecords.push({ recordId, reason: "unavailable" });
      evidenceGaps.push(
        `Selected archive record ${recordId} is unavailable in this archive snapshot.`,
      );
      continue;
    }

    const projection = projectRecord(record);
    const signals = signalsForRecord(record);
    supersededMaterial.push(...signals.supersededMaterial);
    conflictSignals.push(...signals.conflictSignals);
    uncertaintySignals.push(...signals.uncertaintySignals);
    evidenceGaps.push(...signals.evidenceGaps);
    includedRecords.push(projection);
  }

  if (scope.recordIds.length === 0) {
    evidenceGaps.unshift(
      "No archive records are selected; the Case Reading has no canonical archive evidence.",
    );
  }

  const parts: CaseReadingBundleParts = {
    selectedRecordIds: [...scope.recordIds],
    ownerContext: scope.freeTextContext,
    includedRecords,
    excludedRecords,
    truncation: {
      occurred: includedRecords.some(
        (record) => record.truncatedFields.length > 0 || record.omittedFields.length > 0,
      ),
      omittedRecordIds,
      omittedSignalCounts: [],
      omittedEvidenceGapCount: 0,
      ownerContextTruncated: false,
      reason: includedRecords.some((record) => record.truncatedFields.length > 0)
        ? TRUNCATION_REASON
        : null,
    },
    supersededMaterial,
    conflictSignals,
    uncertaintySignals,
    evidenceGaps: [...new Set(evidenceGaps)],
  };

  while (
    bundleSize(parts) > CASE_READING_MAX_CHARS &&
    parts.supersededMaterial.length + parts.conflictSignals.length + parts.uncertaintySignals.length
  ) {
    compactSignals(parts);
    if (
      parts.supersededMaterial.length +
        parts.conflictSignals.length +
        parts.uncertaintySignals.length ===
      0
    ) {
      break;
    }
  }
  while (bundleSize(parts) > CASE_READING_MAX_CHARS && parts.includedRecords.length) {
    compactLastRecord(parts);
  }
  compactEvidenceGaps(parts);
  compactOwnerContext(parts);

  const finalBundle = finalizeBundle(parts);
  if (finalBundle.serializedChars <= CASE_READING_MAX_CHARS) return finalBundle;

  const availableRecordIds = scope.recordIds.filter((recordId) => recordsById.has(recordId));
  return finalizeBundle(compactToMinimalBundle(parts, availableRecordIds));
}
