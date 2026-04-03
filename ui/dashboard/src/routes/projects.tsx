/**
 * Projects route — project management with git integration + hosting.
 */

import { Projects } from "@/components/Projects.js";
import { useRootContext } from "./root.js";

export default function ProjectsPage() {
  const { projectsHook, projectActivity, onOpenChat, hostingHook, configHook } = useRootContext();
  const contributingEnabled = Boolean(configHook.data?.dev?.enabled);

  return (
    <Projects
      projects={projectsHook.projects}
      loading={projectsHook.loading}
      error={projectsHook.error}
      creating={projectsHook.creating}
      updating={projectsHook.updating}
      onCreate={projectsHook.create}
      onUpdate={projectsHook.update}
      onRefresh={() => { void projectsHook.refresh(); void hostingHook.refresh(); }}
      onOpenChat={onOpenChat}
      projectActivity={projectActivity}
      hostingStatus={hostingHook.status}
      onHostingEnable={hostingHook.enable}
      onHostingDisable={hostingHook.disable}
      onHostingConfigure={hostingHook.configure}
      onHostingRestart={hostingHook.restart}
      hostingBusy={hostingHook.enabling || hostingHook.disabling || hostingHook.configuring || hostingHook.restarting}
      contributingEnabled={contributingEnabled}
    />
  );
}
