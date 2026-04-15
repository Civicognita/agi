---
name: status
description: Report gateway and entity status
domain: utility
triggers:
  - status
  - what state
  - are you online
  - system status
  - hf status
  - models status
  - huggingface status
priority: 0
direct_invoke: true
---

Report the current operational status including:
- Gateway state (ONLINE/LIMBO/OFFLINE/UNKNOWN)
- Entity verification tier and capabilities
- Available tools in current state
- Channel connectivity
- HuggingFace Marketplace status: whether it is enabled, how many models are installed, and how many are currently running — use the `hf_models` tool with action `"status"` to get live data

In LIMBO state, note that remote operations are queued locally.
In OFFLINE state, note that only local operations are available.
Be honest about limitations based on current state.

When HF models are running, mention their names and that they are available as inference endpoints for MApps and agent tools. When no models are running, briefly mention that models can be started from Admin > HF Models.
