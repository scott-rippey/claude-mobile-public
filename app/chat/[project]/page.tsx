import { ChatInterface } from "@/components/ChatInterface";

interface ChatPageProps {
  params: Promise<{ project: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { project } = await params;
  const projectPath = decodeURIComponent(project);
  const projectName = projectPath.split("/").pop() || projectPath;

  return <ChatInterface projectPath={projectPath} projectName={projectName} />;
}
