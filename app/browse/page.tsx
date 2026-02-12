import { FileBrowser } from "@/components/FileBrowser";
import { LogoutButton } from "@/components/LogoutButton";
import { Home } from "lucide-react";

export default function BrowseRootPage() {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Home size={16} className="text-accent" />
          <span className="font-semibold flex-1">App Development</span>
          <LogoutButton />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <FileBrowser path="" />
      </main>
    </div>
  );
}
