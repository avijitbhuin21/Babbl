import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Toaster, toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import { Sidebar, RAIL_ITEMS, TRANSCRIBE_PAGES, useTranscribePages } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { useNavStore } from "./stores/navStore";
import { commands } from "@/bindings";

interface AppErrorPayload {
  title: string;
  message: string;
}

function App() {
  const { t } = useTranslation();
  const { rail, transcribePage } = useNavStore();
  const transcribePages = useTranscribePages();
  const { settings, updateSetting } = useSettings();

  const page =
    rail === "transcribe"
      ? TRANSCRIBE_PAGES[transcribePages.includes(transcribePage) ? transcribePage : "general"]
      : RAIL_ITEMS[rail];
  const ActivePage = page.component;

  useEffect(() => {
    const unlisten = listen<AppErrorPayload>("babbl://error", (event) => {
      const { title, message } = event.payload;
      toast.error(title, { description: message, duration: 8000 });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ summary: string; peers: string[] }>("share-received", (event) => {
      const { summary, peers } = event.payload;
      toast.success(`Received ${summary}`, {
        description: peers[0] ? `From ${peers[0]}` : undefined,
        duration: 8000,
        action: {
          label: "Open",
          onClick: () => commands.shareOpenFolder("received"),
        },
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Handle keyboard shortcuts for debug mode toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+D (Windows/Linux) or Cmd+Shift+D (macOS)
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <Toaster position="bottom-right" richColors closeButton theme="dark" />
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {/* Scrollable content area with more breathing room */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col py-8 px-6 gap-6 max-w-3xl mx-auto w-full">
              <h1 className="text-lg font-semibold text-text/90 tracking-tight">
                {t(page.labelKey, page.fallback)}
              </h1>
              <AccessibilityPermissions />
              <ActivePage />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
