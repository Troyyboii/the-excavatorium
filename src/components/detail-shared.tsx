import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordDetail } from "@/components/record-detail";
import type { RecordType } from "@/lib/types";
import { EmptyState, PageHeader } from "@/components/page-parts";

export function DetailPage({ type }: { type: RecordType }) {
  const q = useArchive(true);
  const params = useParamsForType();
  const id = params.id;

  if (q.isPending) return <PageHeader title="Loading…" />;
  const rec = q.data?.byId.get(id);
  if (!rec || rec.recordType !== type) {
    return (
      <div>
        <PageHeader title="Record not found" />
        <EmptyState title={`No ${type} matches this ID.`} />
      </div>
    );
  }
  return (
    <RecordDetail
      record={rec}
      allRecords={q.data!.records}
      allLinks={q.data!.links}
      byId={q.data!.byId}
    />
  );
}

// Route hooks are inline in the actual route files; this helper is a stub for typing.
function useParamsForType(): { id: string } {
  // Overridden in route files that call this via useParams; kept for shared types.
  return { id: "" };
}

// Not exported as a route. Prevent unused warning:
export const _routeGuard = createFileRoute;
