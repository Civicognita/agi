/**
 * Projects route — project management with git integration + hosting.
 */

import { Projects } from "@/components/Projects.js";
import { PageScroll } from "@/components/PageScroll.js";
import { useRootContext } from "./root.js";
import { useIsTestVm } from "@/hooks/useRuntimeMode.js";

export default function ProjectsPage() {
  const { projectsHook, projectActivity, onOpenChat, hostingHook, configHook } = useRootContext();
  const isTestVm = useIsTestVm();
  // Force-disable contributing-mode in test-VM (s122 t463) so the
  // aionima-collection tiles + sacred-project drilldowns don't appear.
  const contributingEnabled = !isTestVm && Boolean(configHook.data?.dev?.enabled);

  return (
    <PageScroll>
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
    </PageScroll>
  );
}
