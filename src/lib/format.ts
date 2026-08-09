import type {
  ArchiveExport,
  ArchiveLink,
  ArchiveRecord,
  ConversationData,
  DecisionData,
  DocumentData,
  RecordType,
  RepositoryData,
  ToolData,
} from "./types";
import { documentDataSchema } from "./document";
import {
  CONFIDENCE_LEVELS,
  DECISION_STATUSES,
  PROJECT_ROUTES,
  RATING_LEVELS,
  REPOSITORY_ACTIONS,
  TOOL_STATUSES,
  UUID_RE,
} from "./types";

// ---------- Approved canonical seed keys (frozen backup contract) ----------
// Every canonical example record has a fixed recordType. Every canonical link
// has a fixed (sourceSeed, targetSeed) endpoint pair. The frozen contract is
// oriented — the link seed key names its source first, then its target.
export const APPROVED_RECORD_SEED_KEYS: Readonly<Record<string, RecordType>> = {
  "example-tool-chatgpt": "tool",
  "example-tool-perplexity": "tool",
  "example-tool-obsidian": "tool",
  "example-tool-codex": "tool",
  "example-tool-grok": "tool",
  "example-tool-mem0": "tool",
  "example-repository-mem0": "repository",
  "example-conversation-excavatorium-origin": "conversation",
  "example-decision-chatgpt-primary": "decision",
  "example-decision-perplexity-research": "decision",
  "example-decision-grok-media": "decision",
  "example-decision-no-mem0": "decision",
  "example-decision-obsidian-vault": "decision",
};

export const APPROVED_LINK_SEED_KEYS: Readonly<Record<string, { source: string; target: string }>> =
  {
    "example-link-conversation-chatgpt": {
      source: "example-conversation-excavatorium-origin",
      target: "example-tool-chatgpt",
    },
    "example-link-conversation-grok": {
      source: "example-conversation-excavatorium-origin",
      target: "example-tool-grok",
    },
    "example-link-conversation-mem0": {
      source: "example-conversation-excavatorium-origin",
      target: "example-tool-mem0",
    },
    "example-link-conversation-repository-mem0": {
      source: "example-conversation-excavatorium-origin",
      target: "example-repository-mem0",
    },
    "example-link-conversation-decision-no-mem0": {
      source: "example-conversation-excavatorium-origin",
      target: "example-decision-no-mem0",
    },
    "example-link-conversation-decision-grok-media": {
      source: "example-conversation-excavatorium-origin",
      target: "example-decision-grok-media",
    },
    "example-link-mem0-repository": {
      source: "example-tool-mem0",
      target: "example-repository-mem0",
    },
    "example-link-decision-chatgpt-tool": {
      source: "example-decision-chatgpt-primary",
      target: "example-tool-chatgpt",
    },
    "example-link-decision-obsidian-tool": {
      source: "example-decision-obsidian-vault",
      target: "example-tool-obsidian",
    },
  };

// ---------- Tag normalization (spec §8) ----------
export function normalizeTags(input: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of input) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return Array.from(seen.values());
}

// ---------- Filename helpers ----------
export function backupFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `the-excavatorium-backup-${y}-${m}-${d}-${hh}${mm}.json`;
}

// ---------- Backup builder (spec §19) ----------
export function buildBackup(records: ArchiveRecord[], links: ArchiveLink[]): ArchiveExport {
  const sortedRecords = [...records]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record) => {
      if (record.recordType !== "document") return record;
      return {
        ...record,
        recordData: {
          ...record.recordData,
          // JSON backups do not contain private Storage objects. Preserve the
          // document's conclusions and display metadata as a detached record.
          storagePath: null,
          extractedContentPath: null,
          contentHash: null,
        },
      };
    });
  const sortedLinks = [...links].sort((a, b) => a.id.localeCompare(b.id));
  return {
    application: "The Excavatorium",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    records: sortedRecords,
    links: sortedLinks,
  };
}

// ---------- Backup validation ----------
export type ValidationResult =
  | { ok: true; export: ArchiveExport; counts: BackupCounts }
  | { ok: false; error: string };

export type BackupCounts = {
  schemaVersion: number;
  totalRecords: number;
  tool: number;
  repository: number;
  conversation: number;
  decision: number;
  document: number;
  links: number;
  examples: number;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isRating(v: unknown): boolean {
  return typeof v === "string" && (RATING_LEVELS as string[]).includes(v);
}

function validateRecordData(type: RecordType, d: unknown): string | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "recordData must be an object";
  const rd = d as Record<string, unknown>;
  const req = (k: string, cond: boolean) => (cond ? null : `missing or invalid field ${k}`);

  if (type === "tool") {
    const t = rd as unknown as ToolData;
    const errs = [
      req("category", typeof t.category === "string"),
      req("status", typeof t.status === "string" && (TOOL_STATUSES as string[]).includes(t.status)),
      req("whatCaughtMyEye", typeof t.whatCaughtMyEye === "string"),
      req("whatItPromised", typeof t.whatItPromised === "string"),
      req("whatActuallyHappened", typeof t.whatActuallyHappened === "string"),
      req("whatWorked", typeof t.whatWorked === "string"),
      req("whatFailed", typeof t.whatFailed === "string"),
      req("whyIKeptOrStoppedUsingIt", typeof t.whyIKeptOrStoppedUsingIt === "string"),
      req(
        "replacementToolId",
        t.replacementToolId === null ||
          (typeof t.replacementToolId === "string" && UUID_RE.test(t.replacementToolId)),
      ),
      req("revisitCondition", typeof t.revisitCondition === "string"),
      req("finalVerdict", typeof t.finalVerdict === "string"),
      req(
        "lastReviewed",
        t.lastReviewed === null ||
          (typeof t.lastReviewed === "string" && ISO_DATE_RE.test(t.lastReviewed)),
      ),
    ];
    return errs.find(Boolean) ?? null;
  }
  if (type === "repository") {
    const r = rd as unknown as RepositoryData;
    const errs = [
      req("githubUrl", typeof r.githubUrl === "string"),
      req("whatCaughtMyEye", typeof r.whatCaughtMyEye === "string"),
      req("whatItClaims", typeof r.whatItClaims === "string"),
      req("whatItActuallyDoes", typeof r.whatItActuallyDoes === "string"),
      req("maintenanceImpression", typeof r.maintenanceImpression === "string"),
      req("complexity", isRating(r.complexity)),
      req("risk", isRating(r.risk)),
      req("integrationCost", isRating(r.integrationCost)),
      req("immediateUsefulness", isRating(r.immediateUsefulness)),
      req("longTermValue", isRating(r.longTermValue)),
      req(
        "recommendedAction",
        r.recommendedAction === null ||
          (typeof r.recommendedAction === "string" &&
            (REPOSITORY_ACTIONS as string[]).includes(r.recommendedAction)),
      ),
      req("finalVerdict", typeof r.finalVerdict === "string"),
      req(
        "lastReviewed",
        r.lastReviewed === null ||
          (typeof r.lastReviewed === "string" && ISO_DATE_RE.test(r.lastReviewed)),
      ),
    ];
    return errs.find(Boolean) ?? null;
  }
  if (type === "conversation") {
    const c = rd as unknown as ConversationData;
    const errs = [
      req(
        "conversationDate",
        c.conversationDate === null ||
          (typeof c.conversationDate === "string" && ISO_DATE_RE.test(c.conversationDate)),
      ),
      req(
        "projectRoute",
        typeof c.projectRoute === "string" && (PROJECT_ROUTES as string[]).includes(c.projectRoute),
      ),
      req("highSignalFindings", typeof c.highSignalFindings === "string"),
      req("decisionsMade", typeof c.decisionsMade === "string"),
      req("openLoops", typeof c.openLoops === "string"),
      req("reusablePrompts", typeof c.reusablePrompts === "string"),
      req("memoryCandidates", typeof c.memoryCandidates === "string"),
      req("rawConversationText", typeof c.rawConversationText === "string"),
    ];
    return errs.find(Boolean) ?? null;
  }
  if (type === "document") {
    const parsed = documentDataSchema.safeParse(d);
    return parsed.success ? null : "document recordData is malformed";
  }
  const dd = rd as unknown as DecisionData;
  const errs = [
    req("reason", typeof dd.reason === "string"),
    req("trigger", typeof dd.trigger === "string"),
    req("whatWouldChangeMyMind", typeof dd.whatWouldChangeMyMind === "string"),
    req("decisionDate", typeof dd.decisionDate === "string" && ISO_DATE_RE.test(dd.decisionDate)),
    req(
      "status",
      typeof dd.status === "string" && (DECISION_STATUSES as string[]).includes(dd.status),
    ),
    req(
      "confidence",
      typeof dd.confidence === "string" && (CONFIDENCE_LEVELS as string[]).includes(dd.confidence),
    ),
    req(
      "supersedesDecisionId",
      dd.supersedesDecisionId === null ||
        (typeof dd.supersedesDecisionId === "string" && UUID_RE.test(dd.supersedesDecisionId)),
    ),
  ];
  return errs.find(Boolean) ?? null;
}

export function validateBackup(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "Backup is not a JSON object" };
  const o = raw as Record<string, unknown>;
  if (o.application !== "The Excavatorium") return { ok: false, error: "Wrong application name" };
  if (o.schemaVersion !== 1) return { ok: false, error: "Unsupported schemaVersion (expected 1)" };
  if (typeof o.exportedAt !== "string" || !ISO_TS_RE.test(o.exportedAt))
    return { ok: false, error: "exportedAt must be an ISO-8601 UTC timestamp" };
  // ISO_TS_RE already anchors to Z (UTC). Additionally require a valid parse.
  if (Number.isNaN(Date.parse(o.exportedAt)))
    return { ok: false, error: "exportedAt is not a real UTC timestamp" };

  if (!Array.isArray(o.records)) return { ok: false, error: "Missing records array" };
  if (!Array.isArray(o.links)) return { ok: false, error: "Missing links array" };

  const recordIds = new Set<string>();
  const seedKeys = new Set<string>();
  const seedKeyToId = new Map<string, string>();
  const linkIds = new Set<string>();
  const linkSeedKeys = new Set<string>();
  const linkPairs = new Set<string>();

  const counts: BackupCounts = {
    schemaVersion: 1,
    totalRecords: 0,
    tool: 0,
    repository: 0,
    conversation: 0,
    decision: 0,
    document: 0,
    links: 0,
    examples: 0,
  };

  for (const [i, r] of (o.records as unknown[]).entries()) {
    if (!r || typeof r !== "object") return { ok: false, error: `records[${i}] is not an object` };
    const rec = r as Record<string, unknown>;
    if (typeof rec.id !== "string" || !UUID_RE.test(rec.id))
      return { ok: false, error: `records[${i}].id is not a UUID` };
    if (recordIds.has(rec.id)) return { ok: false, error: `records[${i}].id is a duplicate` };
    recordIds.add(rec.id);
    if (
      typeof rec.recordType !== "string" ||
      !["tool", "repository", "conversation", "decision", "document"].includes(rec.recordType)
    )
      return { ok: false, error: `records[${i}].recordType is invalid` };
    if (typeof rec.title !== "string" || rec.title.trim() === "")
      return { ok: false, error: `records[${i}].title is required` };
    if (typeof rec.summary !== "string")
      return { ok: false, error: `records[${i}].summary must be a string` };
    if (!Array.isArray(rec.tags) || rec.tags.some((t) => typeof t !== "string"))
      return { ok: false, error: `records[${i}].tags must be a string array` };
    if (typeof rec.isExample !== "boolean")
      return { ok: false, error: `records[${i}].isExample must be boolean` };
    if (rec.seedKey !== null && typeof rec.seedKey !== "string")
      return { ok: false, error: `records[${i}].seedKey must be string or null` };
    // Example identity: isExample and seedKey must move together.
    if (rec.isExample === true && rec.seedKey === null)
      return { ok: false, error: `records[${i}] is marked isExample=true but has no seedKey` };
    if (rec.isExample === false && rec.seedKey !== null)
      return { ok: false, error: `records[${i}] has a seedKey but isExample=false` };
    if (typeof rec.seedKey === "string") {
      if (seedKeys.has(rec.seedKey))
        return { ok: false, error: `records[${i}].seedKey "${rec.seedKey}" is duplicated` };
      seedKeys.add(rec.seedKey);
      const approved = APPROVED_RECORD_SEED_KEYS[rec.seedKey];
      if (!approved)
        return {
          ok: false,
          error: `records[${i}].seedKey "${rec.seedKey}" is not an approved canonical seed key`,
        };
      if (approved !== rec.recordType)
        return {
          ok: false,
          error: `records[${i}].seedKey "${rec.seedKey}" belongs to recordType "${approved}", not "${rec.recordType}"`,
        };
      seedKeyToId.set(rec.seedKey, rec.id as string);
    }

    if (typeof rec.createdAt !== "string" || !ISO_TS_RE.test(rec.createdAt))
      return { ok: false, error: `records[${i}].createdAt is malformed` };
    if (typeof rec.updatedAt !== "string" || !ISO_TS_RE.test(rec.updatedAt))
      return { ok: false, error: `records[${i}].updatedAt is malformed` };
    const dataErr = validateRecordData(rec.recordType as RecordType, rec.recordData);
    if (dataErr) return { ok: false, error: `records[${i}]: ${dataErr}` };

    counts.totalRecords += 1;
    counts[rec.recordType as RecordType] += 1;
    if (rec.isExample) counts.examples += 1;
  }

  // Validate replacement/supersession pointers against imported records.
  for (const [i, r] of (o.records as unknown[]).entries()) {
    const rec = r as Record<string, unknown>;
    const data = rec.recordData as Record<string, unknown>;
    if (rec.recordType === "tool" && data.replacementToolId) {
      const t = data.replacementToolId as string;
      const targ = (o.records as unknown[]).find((x) => (x as { id: string }).id === t) as
        | { recordType?: string; id?: string }
        | undefined;
      if (!targ || targ.recordType !== "tool")
        return {
          ok: false,
          error: `records[${i}].replacementToolId must reference an imported Tool`,
        };
      if (targ.id === rec.id)
        return { ok: false, error: `records[${i}].replacementToolId cannot reference itself` };
    }
    if (rec.recordType === "decision" && data.supersedesDecisionId) {
      const t = data.supersedesDecisionId as string;
      const targ = (o.records as unknown[]).find((x) => (x as { id: string }).id === t) as
        | { recordType?: string; id?: string }
        | undefined;
      if (!targ || targ.recordType !== "decision")
        return {
          ok: false,
          error: `records[${i}].supersedesDecisionId must reference an imported Decision`,
        };
      if (targ.id === rec.id)
        return { ok: false, error: `records[${i}].supersedesDecisionId cannot reference itself` };
    }
  }

  for (const [i, l] of (o.links as unknown[]).entries()) {
    if (!l || typeof l !== "object") return { ok: false, error: `links[${i}] is not an object` };
    const link = l as Record<string, unknown>;
    if (typeof link.id !== "string" || !UUID_RE.test(link.id))
      return { ok: false, error: `links[${i}].id is not a UUID` };
    if (linkIds.has(link.id)) return { ok: false, error: `links[${i}].id is a duplicate` };
    linkIds.add(link.id);
    if (typeof link.sourceId !== "string" || !recordIds.has(link.sourceId))
      return { ok: false, error: `links[${i}].sourceId does not reference an imported record` };
    if (typeof link.targetId !== "string" || !recordIds.has(link.targetId))
      return { ok: false, error: `links[${i}].targetId does not reference an imported record` };
    if (link.sourceId === link.targetId) return { ok: false, error: `links[${i}] is a self-link` };
    const low = link.sourceId < link.targetId ? link.sourceId : link.targetId;
    const high = link.sourceId < link.targetId ? link.targetId : link.sourceId;
    const pair = `${low}::${high}`;
    if (linkPairs.has(pair))
      return { ok: false, error: `links[${i}] is a reciprocal or duplicate link` };
    linkPairs.add(pair);
    if (link.seedKey !== null && typeof link.seedKey !== "string")
      return { ok: false, error: `links[${i}].seedKey must be string or null` };
    if (typeof link.seedKey === "string") {
      if (linkSeedKeys.has(link.seedKey))
        return { ok: false, error: `links[${i}].seedKey "${link.seedKey}" is duplicated` };
      linkSeedKeys.add(link.seedKey);
      const approved = APPROVED_LINK_SEED_KEYS[link.seedKey];
      if (!approved)
        return {
          ok: false,
          error: `links[${i}].seedKey "${link.seedKey}" is not an approved canonical link seed key`,
        };
      const expectedSourceId = seedKeyToId.get(approved.source);
      const expectedTargetId = seedKeyToId.get(approved.target);
      if (!expectedSourceId || !expectedTargetId)
        return {
          ok: false,
          error: `links[${i}].seedKey "${link.seedKey}" requires records with seedKeys "${approved.source}" and "${approved.target}" to also be imported`,
        };
      // Canonical links are oriented (source → target). Reject both a wrong
      // orientation and any mapping to different endpoints.
      if (link.sourceId !== expectedSourceId || link.targetId !== expectedTargetId)
        return {
          ok: false,
          error: `links[${i}].seedKey "${link.seedKey}" endpoints do not match canonical (source="${approved.source}", target="${approved.target}")`,
        };
    }
    if (typeof link.createdAt !== "string" || !ISO_TS_RE.test(link.createdAt))
      return { ok: false, error: `links[${i}].createdAt is malformed` };
    counts.links += 1;
  }

  return { ok: true, export: o as unknown as ArchiveExport, counts };
}

// ---------- Markdown export (spec §21) ----------
function yaml(scalar: unknown): string {
  if (scalar === null || scalar === undefined) return "null";
  if (typeof scalar === "number" || typeof scalar === "boolean") return String(scalar);
  const s = String(scalar);
  if (s === "") return '""';
  if (/[:#[\]{},&*!|>'"%@`\n-]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

function yamlList(items: string[]): string {
  if (items.length === 0) return "[]";
  return "\n" + items.map((t) => `  - ${yaml(t)}`).join("\n");
}

function connectedRef(rec: ArchiveRecord): string {
  return `[[${rec.recordType}-${rec.id}|${rec.title}]]`;
}

function section(heading: string, body: string): string {
  const trimmed = body?.trim?.() ?? "";
  if (!trimmed) return "";
  return `\n## ${heading}\n\n${trimmed}\n`;
}

export function toMarkdown(
  record: ArchiveRecord,
  linkedRecords: ArchiveRecord[],
  backlinkedRecords: ArchiveRecord[],
  byId: Map<string, ArchiveRecord>,
): { filename: string; body: string } {
  const filename = `${record.recordType}-${record.id}.md`;
  const fm: string[] = [
    "---",
    `type: ${record.recordType}`,
    `title: ${yaml(record.title)}`,
    `id: ${record.id}`,
    `isExample: ${record.isExample}`,
    `createdAt: ${record.createdAt}`,
    `updatedAt: ${record.updatedAt}`,
    `tags: ${yamlList(record.tags)}`,
  ];
  const d = record.recordData as Record<string, unknown>;
  for (const [k, v] of Object.entries(d)) {
    if (
      record.recordType === "document" &&
      ["storagePath", "extractedContentPath", "contentHash"].includes(k)
    )
      continue;
    if (Array.isArray(v) && v.every((item) => typeof item === "string")) {
      fm.push(`${k}: ${yamlList(v as string[])}`);
    } else if (v && typeof v === "object") {
      fm.push(`${k}: ${yaml(JSON.stringify(v))}`);
    } else {
      fm.push(`${k}: ${yaml(v)}`);
    }
  }
  fm.push("---");

  let body = fm.join("\n") + "\n\n";
  body += `# ${record.title}\n`;
  body += section("Summary", record.summary);

  // Type-specific narrative sections.
  if (record.recordType === "tool") {
    body += section("What caught my eye", record.recordData.whatCaughtMyEye);
    body += section("What it promised", record.recordData.whatItPromised);
    body += section("What actually happened", record.recordData.whatActuallyHappened);
    body += section("What worked", record.recordData.whatWorked);
    body += section("What failed", record.recordData.whatFailed);
    body += section("Why I kept or stopped using it", record.recordData.whyIKeptOrStoppedUsingIt);
    body += section("Revisit condition", record.recordData.revisitCondition);
    body += section("Final verdict", record.recordData.finalVerdict);
    if (record.recordData.replacementToolId) {
      const r = byId.get(record.recordData.replacementToolId);
      if (r) body += section("Replacement", connectedRef(r));
    }
  } else if (record.recordType === "repository") {
    body += section("GitHub URL", record.recordData.githubUrl);
    body += section("What caught my eye", record.recordData.whatCaughtMyEye);
    body += section("What it claims", record.recordData.whatItClaims);
    body += section("What it actually does", record.recordData.whatItActuallyDoes);
    body += section("Maintenance impression", record.recordData.maintenanceImpression);
    body += section("Final verdict", record.recordData.finalVerdict);
  } else if (record.recordType === "conversation") {
    body += section("High signal findings", record.recordData.highSignalFindings);
    body += section("Decisions made", record.recordData.decisionsMade);
    body += section("Open loops", record.recordData.openLoops);
    body += section("Reusable prompts", record.recordData.reusablePrompts);
    body += section("Memory candidates", record.recordData.memoryCandidates);
    body += section("Raw conversation text", record.recordData.rawConversationText);
  } else if (record.recordType === "decision") {
    body += section("Reason", record.recordData.reason);
    body += section("Trigger", record.recordData.trigger);
    body += section("What would change my mind", record.recordData.whatWouldChangeMyMind);
    if (record.recordData.supersedesDecisionId) {
      const r = byId.get(record.recordData.supersedesDecisionId);
      if (r) body += section("Supersedes", connectedRef(r));
    }
  } else {
    const insightBody = (items: DocumentData["highSignalFindings"]) =>
      items
        .map(
          (item) =>
            `${item.text}${item.sourceReferenceIds.length ? `\nSources: ${item.sourceReferenceIds.join(", ")}` : ""}`,
        )
        .join("\n\n");
    body += section(
      "Document details",
      [
        record.recordData.originalFileName
          ? `Original file: ${record.recordData.originalFileName}`
          : "",
        record.recordData.documentDate ? `Document date: ${record.recordData.documentDate}` : "",
        record.recordData.pageCount === null ? "" : `Page count: ${record.recordData.pageCount}`,
        record.recordData.projectRoute ? `Project route: ${record.recordData.projectRoute}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    body += section("High-signal findings", insightBody(record.recordData.highSignalFindings));
    body += section("Key claims", insightBody(record.recordData.keyClaims));
    body += section("Contradictions", insightBody(record.recordData.contradictions));
    body += section("Uncertainties", insightBody(record.recordData.uncertainties));
    body += section(
      "Source references",
      record.recordData.sourceReferences
        .map((ref) => `${ref.label} (${ref.locator})${ref.note ? `\n${ref.note}` : ""}`)
        .join("\n\n"),
    );
  }

  if (linkedRecords.length) {
    body += `\n## Linked records\n\n`;
    for (const r of linkedRecords) body += `- ${connectedRef(r)}\n`;
  }
  if (backlinkedRecords.length) {
    body += `\n## Backlinks\n\n`;
    for (const r of backlinkedRecords) body += `- ${connectedRef(r)}\n`;
  }

  return { filename, body };
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
