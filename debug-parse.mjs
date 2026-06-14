import { parse as yamlParse } from "yaml";

const yaml = `id: "plan_LEGACY01"
title: "Legacy"
status: "draft"
projectPath: "/tmp/x"
chatSessionId: null
createdAt: "2026-04-14T00:00:00.000Z"
updatedAt: "2026-04-14T00:00:00.000Z"
tynnRefs:
  versionId: null
  storyIds: []
  taskIds: []
steps: []`;

console.log(JSON.stringify(yamlParse(yaml), null, 2));
