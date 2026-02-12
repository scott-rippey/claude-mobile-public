import Link from "next/link";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { FileBrowser } from "@/components/FileBrowser";
import { FileViewer } from "@/components/FileViewer";
import { LogoutButton } from "@/components/LogoutButton";

interface BrowsePageProps {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ view?: string }>;
}

export default async function BrowsePage({
  params,
  searchParams,
}: BrowsePageProps) {
  const { path: pathSegments } = await params;
  const { view } = await searchParams;
  const currentPath = pathSegments
    .map((s) => decodeURIComponent(s))
    .join("/");
  const isViewing = view === "true";

  // Parent path for back button
  const parentPath =
    pathSegments.length <= 1
      ? "/browse"
      : `/browse/${pathSegments
          .slice(0, -1)
          .map((s) => encodeURIComponent(decodeURIComponent(s)))
          .join("/")}`;

  // Build breadcrumb parts
  const breadcrumbs = pathSegments.map((segment, index) => ({
    name: decodeURIComponent(segment),
    path: pathSegments
      .slice(0, index + 1)
      .map((s) => encodeURIComponent(decodeURIComponent(s)))
      .join("/"),
  }));

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Header with breadcrumbs */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <Link
            href={parentPath}
            className="text-accent p-1 shrink-0"
          >
            <ChevronLeft size={20} />
          </Link>
          <nav className="flex items-center gap-1 text-sm overflow-x-auto flex-1">
            <Link
              href="/browse"
              className="text-muted hover:text-foreground transition-colors shrink-0"
            >
              <Home size={16} />
            </Link>
            {breadcrumbs.map((crumb) => (
              <span key={crumb.path} className="flex items-center gap-1 shrink-0">
                <ChevronRight size={14} className="text-muted/50" />
                <Link
                  href={`/browse/${crumb.path}`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {crumb.name}
                </Link>
              </span>
            ))}
          </nav>
          <LogoutButton />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        {isViewing ? (
          <FileViewer path={currentPath} />
        ) : (
          <FileBrowser path={currentPath} />
        )}
      </main>
    </div>
  );
}
