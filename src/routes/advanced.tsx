import { createFileRoute } from "@tanstack/react-router";
import { RunRoomPage } from "@/components/custodian/run-room-page";

export const Route = createFileRoute("/advanced")({ component: RunRoomPage, ssr: false });
