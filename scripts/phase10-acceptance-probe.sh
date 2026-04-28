#!/usr/bin/env bash
# Phase 10 acceptance probe — proves the local-model chat pipeline works
# end-to-end from the test VM. Runs a single "5+2" round-trip via the
# WebSocket control plane and asserts a correct numeric response comes
# back within a wall-clock bound.
#
# Expected baseline (CPU qwen2.5:3b, 4-core VM, system prompt ~820 tokens):
#   ~110-120 s for a single-turn "What is 5+2?" response.
#
# Pipeline verified by this probe:
#   1. WebSocket state_change transitions gateway to ONLINE.
#   2. chat:open creates a session for the owner entity.
#   3. chat:send enters the agent-invoker pipeline.
#   4. Router picks ollama/qwen2.5:3b under costMode=local (no escalation).
#   5. chat:response surfaces the model's text + routing metadata.
#
# Prerequisites (normally set up by scripts/test-vm.sh services-start):
#   - Ollama running with qwen2.5:3b pulled
#   - gateway.json has agent.provider=ollama, costMode=local
#   - owner.channels.telegram is populated → owner entity resolves
#   - Playwright :80 bridge present in /etc/caddy/Caddyfile
#
# Usage: bash scripts/phase10-acceptance-probe.sh [VM_NAME]
# Exit codes: 0 = acceptance passed; non-zero = failure mode identified
set -euo pipefail

VM="${1:-agi-test}"
TIMEOUT_S=300

multipass exec "$VM" -- bash -lc "
  WS=\$(find /mnt/agi/node_modules/.pnpm -maxdepth 2 -type d -name 'ws@*' 2>/dev/null | head -1)
  [ -z \"\$WS\" ] && { echo 'ws module not found in /mnt/agi'; exit 2; }
  timeout ${TIMEOUT_S} node -e '
    const WebSocket = require(\"'\$WS/node_modules/ws'\");
    const ws = new WebSocket(\"ws://127.0.0.1:3100/\");
    const start = Date.now();
    const log = (tag, d) => console.log(\`[\${((Date.now()-start)/1000).toFixed(1)}s] \${tag}: \${d ?? \"\"}\`);
    const sessionId = \"phase10-\" + Date.now();
    let responseReceived = false;
    ws.on(\"open\", () => {
      log(\"ws-open\");
      ws.send(JSON.stringify({type:\"state_change\",payload:{to:\"ONLINE\"}}));
      setTimeout(() => {
        log(\"chat:open\", sessionId);
        ws.send(JSON.stringify({type:\"chat:open\",payload:{sessionId, context:\"General\"}}));
        setTimeout(() => {
          log(\"chat:send\", \"What is 5+2?\");
          ws.send(JSON.stringify({type:\"chat:send\",payload:{sessionId, text:\"What is 5 plus 2? Respond with ONLY the digits.\"}}));
        }, 1000);
      }, 500);
    });
    ws.on(\"message\", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === \"chat:response\") {
        responseReceived = true;
        const meta = m.payload?.routingMeta ?? {};
        const text = m.payload?.text ?? \"\";
        log(\"chat:response\", \`text=\"\${text}\" provider=\${meta.provider} model=\${meta.model} costMode=\${meta.costMode}\`);
        const ok = meta.provider === \"ollama\" && meta.costMode === \"local\" && /\\b7\\b/.test(text);
        setTimeout(() => { ws.close(); process.exit(ok ? 0 : 1); }, 200);
      } else if (m.type === \"chat:error\") {
        log(\"chat:error\", JSON.stringify(m.payload).slice(0,200));
        setTimeout(() => { ws.close(); process.exit(4); }, 200);
      }
    });
    ws.on(\"error\", (e) => { log(\"ws-error\", e.message); process.exit(3); });
    setTimeout(() => { if (!responseReceived) { log(\"timeout\"); ws.close(); process.exit(5); } }, ${TIMEOUT_S}000 - 5000);
  '
"
