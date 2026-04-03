import type { AionimaPluginAPI } from "@aionima/plugins";

// Code domain
import { codeEngineer } from "./prompts/code/engineer.js";
import { codeHacker } from "./prompts/code/hacker.js";
import { codeReviewer } from "./prompts/code/reviewer.js";
import { codeTester } from "./prompts/code/tester.js";

// Knowledge domain
import { kAnalyst } from "./prompts/k/analyst.js";
import { kCryptologist } from "./prompts/k/cryptologist.js";
import { kLibrarian } from "./prompts/k/librarian.js";
import { kLinguist } from "./prompts/k/linguist.js";

// UX domain
import { uxDesignerWeb } from "./prompts/ux/designer-web.js";
import { uxDesignerCli } from "./prompts/ux/designer-cli.js";

// Strategy domain
import { stratPlanner } from "./prompts/strat/planner.js";
import { stratPrioritizer } from "./prompts/strat/prioritizer.js";

// Communications domain
import { commWriterTech } from "./prompts/comm/writer-tech.js";
import { commWriterPolicy } from "./prompts/comm/writer-policy.js";
import { commEditor } from "./prompts/comm/editor.js";

// Operations domain
import { opsDeployer } from "./prompts/ops/deployer.js";
import { opsCustodian } from "./prompts/ops/custodian.js";
import { opsSyncer } from "./prompts/ops/syncer.js";

// Governance domain
import { govAuditor } from "./prompts/gov/auditor.js";
import { govArchivist } from "./prompts/gov/archivist.js";

// Data domain
import { dataModeler } from "./prompts/data/modeler.js";
import { dataMigrator } from "./prompts/data/migrator.js";

// Standalone workers
import { standaloneAnalyst } from "./prompts/standalone/analyst.js";
import { standaloneResearcher } from "./prompts/standalone/researcher.js";
import { standaloneReviewer } from "./prompts/standalone/reviewer.js";
import { standaloneScribe } from "./prompts/standalone/scribe.js";
import { standaloneTester } from "./prompts/standalone/tester.js";
import { standaloneReporter } from "./prompts/standalone/reporter.js";
import { standaloneStrategist } from "./prompts/standalone/strategist.js";

export function registerAllWorkers(api: AionimaPluginAPI): void {
  // Code domain
  api.registerWorker(codeEngineer);
  api.registerWorker(codeHacker);
  api.registerWorker(codeReviewer);
  api.registerWorker(codeTester);

  // Knowledge domain
  api.registerWorker(kAnalyst);
  api.registerWorker(kCryptologist);
  api.registerWorker(kLibrarian);
  api.registerWorker(kLinguist);

  // UX domain
  api.registerWorker(uxDesignerWeb);
  api.registerWorker(uxDesignerCli);

  // Strategy domain
  api.registerWorker(stratPlanner);
  api.registerWorker(stratPrioritizer);

  // Communications domain
  api.registerWorker(commWriterTech);
  api.registerWorker(commWriterPolicy);
  api.registerWorker(commEditor);

  // Operations domain
  api.registerWorker(opsDeployer);
  api.registerWorker(opsCustodian);
  api.registerWorker(opsSyncer);

  // Governance domain
  api.registerWorker(govAuditor);
  api.registerWorker(govArchivist);

  // Data domain
  api.registerWorker(dataModeler);
  api.registerWorker(dataMigrator);

  // Standalone workers
  api.registerWorker(standaloneAnalyst);
  api.registerWorker(standaloneResearcher);
  api.registerWorker(standaloneReviewer);
  api.registerWorker(standaloneScribe);
  api.registerWorker(standaloneTester);
  api.registerWorker(standaloneReporter);
  api.registerWorker(standaloneStrategist);
}
