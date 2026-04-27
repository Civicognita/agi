/**
 * Project detail route — full project page with repo, hosting, and settings.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { ProjectDetail } from "@/components/ProjectDetail.js";
import { PageScroll } from "@/components/PageScroll.js";
import { useRootContext } from "./root.js";
import { useIsTestVm } from "@/hooks/useRuntimeMode.js";
import { formatSecurityFixPrompt } from "@/lib/security-fix-prompt.js";
import type { SecurityFinding } from "@/types";

export default function ProjectDetailPage() {
  const { theme, projectsHook, hostingHook, onOpenChat, onOpenChatWithMessage, onOpenEditor, projectActivity, onToolExecute, onOpenTerminal, configHook, onOpenMagicApp } = useRootContext();
  const navigate = useNavigate();
  const isTestVm = useIsTestVm();
  // Contributing-mode is force-disabled in test-VM (s122 t463): the test VM
  // mounts the production source it would write into, so contributing
  // there is recursive/destructive. Production + dev modes honor the flag.
  const contributingEnabled = !isTestVm && Boolean(configHook.data?.dev?.enabled);

  const handleDelete = useCallback(async (params: { path: string; confirm: boolean }) => {
    await projectsHook.remove(params);
    void navigate("/projects");
  }, [projectsHook, navigate]);

  const handleFixFinding = useCallback((projectPath: string, finding: SecurityFinding) => {
    onOpenChatWithMessage(projectPath, formatSecurityFixPrompt(finding));
  }, [onOpenChatWithMessage]);

  return (
    <ProjectDetail
      projects={projectsHook.projects}
      onUpdate={projectsHook.update}
      updating={projectsHook.updating}
      onDelete={handleDelete}
      deleting={projectsHook.deleting}
      onRefresh={() => { void projectsHook.refresh(); void hostingHook.refresh(); }}
      onOpenChat={onOpenChat}
      onOpenEditor={onOpenEditor}
      theme={theme}
      projectActivity={projectActivity}
      hostingStatus={hostingHook.status}
      onHostingConfigure={hostingHook.configure}
      onHostingRestart={hostingHook.restart}
      onTunnelEnable={hostingHook.enableTunnel}
      onTunnelDisable={hostingHook.disableTunnel}
      hostingBusy={hostingHook.configuring || hostingHook.restarting}
      onToolExecute={onToolExecute}
      onOpenTerminal={onOpenTerminal}
      contributingEnabled={contributingEnabled}
      onFixFinding={handleFixFinding}
      onOpenMagicApp={onOpenMagicApp}
    />
  );
}
