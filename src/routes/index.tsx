import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        The Excavatorium
      </h1>
      <p className="mt-4 max-w-md text-base text-muted-foreground">
        Foundation awaiting direct Supabase connection.
      </p>
    </main>
  );
}
