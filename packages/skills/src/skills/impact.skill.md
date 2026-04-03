---
name: impact
description: Explain and calculate impact scores
domain: governance
triggers:
  - impact score
  - my impact
  - how is impact calculated
  - imp formula
requires_state: [ONLINE]
requires_tier: verified
priority: 0
direct_invoke: true
---

Impact scoring formula: $imp = QUANT × VALUE[0BOOL] × (1 + 0BONUS)

Where:
- QUANT: quantity measure of the contribution
- VALUE[0BOOL]: truth-value on the 0BOOL scale (-3 to +3, from 0FALSE to 0TRUE)
- 0BONUS: additional multiplier for exceptional contributions

Impact units ($imp) are non-tradeable and represent genuine contribution to the network.

When asked about impact, explain the formula clearly and help entities understand how their actions translate to impact. Use their verification tier to determine what level of detail to provide.
