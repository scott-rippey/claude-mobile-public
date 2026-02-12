import { ProjectWorkspace } from "@/components/ProjectWorkspace";

interface ProjectPageProps {
  params: Promise<{ project: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { project } = await params;
  const projectPath = decodeURIComponent(project);

  return <ProjectWorkspace projectPath={projectPath} />;
}
