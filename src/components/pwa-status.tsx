import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean(navigator.standalone))
  );
}

export function PwaStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    const updateDisplayMode = () => setStandalone(isStandalone());
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const completeInstall = () => {
      setStandalone(true);
      setInstallPrompt(null);
    };

    updateOnline();
    updateDisplayMode();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("resize", updateDisplayMode);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", completeInstall);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A browser that blocks service workers still gets the online app.
      });
    }

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("resize", updateDisplayMode);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", completeInstall);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (online === null || (online && !installPrompt) || standalone) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:w-auto"
      role="status"
      aria-live="polite"
    >
      <span>
        {online ? "Install The Excavatorium for quick access." : "Offline · no writes are queued."}
      </span>
      {online && installPrompt ? (
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded border border-border px-2 py-1 font-medium text-foreground hover:bg-accent"
        >
          Install
        </button>
      ) : null}
    </div>
  );
}
