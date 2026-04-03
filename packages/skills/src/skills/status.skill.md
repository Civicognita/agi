---
name: status
description: Report gateway and entity status
domain: utility
triggers:
  - status
  - what state
  - are you online
  - system status
priority: 0
direct_invoke: true
---

Report the current operational status including:
- Gateway state (ONLINE/LIMBO/OFFLINE/UNKNOWN)
- Entity verification tier and capabilities
- Available tools in current state
- Channel connectivity

In LIMBO state, note that remote operations are queued locally.
In OFFLINE state, note that only local operations are available.
Be honest about limitations based on current state.
