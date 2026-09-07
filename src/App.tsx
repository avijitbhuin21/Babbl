import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster, toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import Footer from "./components/footer";
import Onboarding from "./components/onboarding";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { commands } from "@/bindings";

interface AppErrorPayload {
  title: string;
  message: string;
}

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return <ActiveComponent />;
};

function App() {
  const { t } = useTranslation();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("general");
  const { settings, updateSetting, isLoading } = useSettings();

  useEffect(() => {
    if (isLoading) return;
    checkOnboardingStatus(settings?.use_online_provider ?? false);
  }, [isLoading, settings?.use_online_provider]);

  useEffect(() => {
    const unlisten = listen<AppErrorPayload>("babbl://error", (event) => {
      const { title, message } = event.payload;
      toast.error(title, { description: message, duration: 8000 });
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

  const checkOnboardingStatus = async (useOnlineProvider: boolean) => {
    if (useOnlineProvider) {
      setShowOnboarding(false);
      return;
    }
    try {
      // Always check if they have any models available
      const result = await commands.hasAnyModelsAvailable();
      if (result.status === "ok") {
        setShowOnboarding(!result.data);
      } else {
        setShowOnboarding(true);
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setShowOnboarding(true);
    }
  };

  const handleModelSelected = () => {
    // Transition to main app - user has started a download
    setShowOnboarding(false);
  };

  if (showOnboarding) {
    return <Onboarding onModelSelected={handleModelSelected} />;
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <Toaster position="bottom-right" richColors closeButton theme="dark" />
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeSection={currentSection}
          onSectionChange={setCurrentSection}
        />
        {/* Scrollable content area with more breathing room */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col py-8 px-8 gap-6 max-w-3xl mx-auto w-full">
              <h1 className="text-lg font-semibold text-text/90 tracking-tight">
                {t(SECTIONS_CONFIG[currentSection]?.labelKey ?? SECTIONS_CONFIG.general.labelKey)}
              </h1>
              <AccessibilityPermissions />
              {renderSettingsContent(currentSection)}
            </div>
          </div>
        </div>
      </div>
      {/* Fixed footer at bottom */}
      <Footer />
    </div>
  );
}

export default App;
