import { createFileRoute } from "@tanstack/react-router";
import { NewRecordPage } from "@/components/new-record-page";
import {
  CustodianLanternArch,
  CustodianLine,
  CustodianPortrait,
} from "@/components/custodian/custodian-presence";

export const Route = createFileRoute("/conversations/new")({ component: Page, ssr: false });
function Page() {
  return (
    <NewRecordPage
      recordType="conversation"
      title="Keep a conversation"
      aside={
        <div className="flex flex-col items-center gap-6">
          <CustodianLanternArch />
          <div className="flex items-start gap-3">
            <CustodianPortrait size={56} />
            <CustodianLine size="sm">
              Lay the transcript before me. I will draw out what matters — and bury nothing without
              your word.
            </CustodianLine>
          </div>
        </div>
      }
    />
  );
}
