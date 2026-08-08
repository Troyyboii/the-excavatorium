import type { ArchiveLink, ArchiveRecord, RecordType } from "./types";
import { RECORD_TYPE_LABEL } from "./types";

export type DashboardRecordItem = {
  record: ArchiveRecord;
  context: string;
  status: string;
  date: string;
  linkedCount: number;
};

export type DashboardBreakdown = {
  key: string;
  label: string;
  count: number;
};

export type DashboardViewModel = {
  totalRecords: number;
  attentionCount: number;
  connectedCount: number;
  isolatedCount: number;
  recentCount: number;
  attentionItems: DashboardRecordItem[];
  recentItems: DashboardRecordItem[];
  isolatedRecords: ArchiveRecord[];
  typeBreakdown: DashboardBreakdown[];
  statusBreakdown: DashboardBreakdown[];
};

const TYPES: RecordType[] = ["conversation", "repository", "tool", "decision"];

function contextFor(record: ArchiveRecord): string {
  if (record.summary.trim()) return record.summary.trim();
  switch (record.recordType) {
    case "conversation":
      return record.recordData.openLoops.trim() || record.recordData.highSignalFindings.trim();
    case "repository":
      return record.recordData.finalVerdict.trim() || record.recordData.whatItActuallyDoes.trim();
    case "tool":
      return record.recordData.finalVerdict.trim() || record.recordData.whatActuallyHappened.trim();
    case "decision":
      return record.recordData.reason.trim();
  }
}

function statusFor(record: ArchiveRecord): string {
  switch (record.recordType) {
    case "conversation":
      return record.recordData.openLoops.trim() ? "Open loop" : record.recordData.projectRoute;
    case "repository":
      return record.recordData.recommendedAction ?? "Awaiting verdict";
    case "tool":
      return record.recordData.status;
    case "decision":
      return `${record.recordData.status} · ${record.recordData.confidence}`;
  }
}

function dateFor(record: ArchiveRecord): string {
  if (record.recordType === "decision" && record.recordData.decisionDate) {
    return record.recordData.decisionDate;
  }
  return record.updatedAt;
}

function needsAttention(record: ArchiveRecord): boolean {
  if (record.recordType === "repository") return record.recordData.recommendedAction === null;
  if (record.recordType === "conversation") return record.recordData.openLoops.trim() !== "";
  if (record.recordType === "decision") return record.recordData.status === "Tentative";
  return ["Worth revisiting", "Useful but dormant", "Experimental"].includes(
    record.recordData.status,
  );
}

export function buildDashboardViewModel(
  records: ArchiveRecord[],
  links: ArchiveLink[],
  now = new Date(),
): DashboardViewModel {
  const recordIds = new Set(records.map((record) => record.id));
  const linkedCount = new Map<string, number>();

  for (const link of links) {
    if (!recordIds.has(link.sourceId) || !recordIds.has(link.targetId)) continue;
    linkedCount.set(link.sourceId, (linkedCount.get(link.sourceId) ?? 0) + 1);
    linkedCount.set(link.targetId, (linkedCount.get(link.targetId) ?? 0) + 1);
  }

  const toItem = (record: ArchiveRecord): DashboardRecordItem => ({
    record,
    context: contextFor(record),
    status: statusFor(record),
    date: dateFor(record),
    linkedCount: linkedCount.get(record.id) ?? 0,
  });

  const byUpdated = (a: ArchiveRecord, b: ArchiveRecord) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);
  const attentionRecords = records.filter(needsAttention).sort(byUpdated);
  const recentCutoff = new Date(now);
  recentCutoff.setDate(recentCutoff.getDate() - 7);
  const recentRecords = records.filter((record) => new Date(record.updatedAt) >= recentCutoff);
  const isolatedRecords = records
    .filter((record) => (linkedCount.get(record.id) ?? 0) === 0)
    .sort(byUpdated);

  const toolStatuses = new Map<string, number>();
  const decisionStatuses = new Map<string, number>();
  for (const record of records) {
    if (record.recordType === "tool") {
      toolStatuses.set(
        record.recordData.status,
        (toolStatuses.get(record.recordData.status) ?? 0) + 1,
      );
    }
    if (record.recordType === "decision") {
      decisionStatuses.set(
        record.recordData.status,
        (decisionStatuses.get(record.recordData.status) ?? 0) + 1,
      );
    }
  }

  return {
    totalRecords: records.length,
    attentionCount: attentionRecords.length,
    connectedCount: records.length - isolatedRecords.length,
    isolatedCount: isolatedRecords.length,
    recentCount: recentRecords.length,
    attentionItems: attentionRecords.slice(0, 7).map(toItem),
    recentItems: [...records].sort(byUpdated).slice(0, 7).map(toItem),
    isolatedRecords,
    typeBreakdown: TYPES.map((type) => ({
      key: type,
      label: RECORD_TYPE_LABEL[type],
      count: records.filter((record) => record.recordType === type).length,
    })),
    statusBreakdown: [
      ...Array.from(toolStatuses, ([key, count]) => ({
        key: `tool-${key}`,
        label: key,
        count,
      })),
      ...Array.from(decisionStatuses, ([key, count]) => ({
        key: `decision-${key}`,
        label: `${key} decisions`,
        count,
      })),
    ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
