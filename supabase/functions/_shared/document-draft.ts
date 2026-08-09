export const DOCUMENT_SYNTHESIS_LIMITS = {
  highSignalFindings: 5,
  keyClaims: 5,
  contradictions: 3,
  uncertainties: 3,
  sourceReferences: 12,
  tags: 8,
  summaryCharacters: 800,
} as const;

export type CompactInsight = {
  text: string;
  sourceReferenceIds: string[];
};

export function normalizeInsightText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function compactInsightList(items: CompactInsight[], max: number): CompactInsight[] {
  const byText = new Map<string, CompactInsight>();
  for (const item of items) {
    const text = normalizeInsightText(item.text);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    const existing = byText.get(key);
    if (existing) {
      existing.sourceReferenceIds = [
        ...new Set([...existing.sourceReferenceIds, ...item.sourceReferenceIds]),
      ].slice(0, 4);
      continue;
    }
    byText.set(key, {
      text,
      sourceReferenceIds: [...new Set(item.sourceReferenceIds)].slice(0, 4),
    });
  }
  return [...byText.values()].slice(0, max);
}

export function orderSourceReferenceIds(ids: string[], sourceOrder: string[]): string[] {
  const order = new Map(sourceOrder.map((id, index) => [id, index]));
  return [...new Set(ids)].sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}
