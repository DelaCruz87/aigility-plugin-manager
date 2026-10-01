# Worker Routing Evidence

Date: 2026-10-01. Author: Codex. Live job: aigility-plugin-manager. Historical attempt records below are evidence of their run time, not an instruction to reuse provider quota assumptions.

## Policy

User asked GLM5.3/GLM5.3Flash/agyGemini3.8Flash bulk delegation and CodexLuna6 fallback. Later explicit Eme steering prioritized GLM5.3Flash after quota reset, avoiding new attempts against confirmed provider limits and recording input/output/cache/duration/validated results. Shared Z.ai quota is not attributed to an individual model.

## Observed Attempts

| Lane | Task | Result observed | Reason and action |
| --- | --- | --- | --- |
| GLM5.3Flash | foundation first | Canceled | 4291302 rate limit, no completed source unit |
| GLM5.3/Flash | parallel modules/services first | Canceled | Shared request limits, switched one simultaneous Z.ai task |
| GLM5.3Flash | migration serial | Source/tests accepted separately | Produced migration and18tests; provider later1308 five-hour usage window stopped final worker completion |
| agyGemini3.8FlashMedium | UI | Ringer pass,2attempts | Executed fake DOM/filter tests; live DOM host review led to correction |
| agyGemini3.8FlashMedium | UI correction | No execution,2provider failures | Individual quota reached, reset reported about3hours; stopped new agy attempts |
| Codex gpt-6-luna | foundation early | Canceled | Network sandbox denied npm DNS; replaced with scoped network-enabled worker |
| Codex gpt-6-luna | foundation network | Ringer pass,2attempts,1210.5s | Foundation3tests/build pass; retry needed missing scratch notes artifact |
| Codex gpt-6-luna | UI correction | Ringer pass,2attempts | Native group replacement/restoration regression tests and scoped CSS |
| Codex gpt-6-luna | runtime/GitHub/debugging | In progress at snapshot | Original module workers, followed by independently confirmed regression gates |
| Codex gpt-6-luna | integration | In progress at snapshot | Own main/guards/docs only; deployment remains gated on acceptance |

## Foundation Token Breakdown

Source: two worker Codex session token_count.total_token_usage events corresponding to Ringer foundation-network. These are cumulative task-level engine records, not exact remaining account/provider quota. Cached input is a subset of input; reasoning output is a subset of output.

| Attempt session | Input | Cached input | Uncached input | Output | Reasoning output | Total engine tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 01a0f6f1-1c89-7702-8fad-dd176b9a3821 | 3790481 | 3658496 | 131985 | 21720 | 9769 | 3812201 |
| 01a0f701-4c82-72c1-b3a0-441e115f3dcb | 611347 | 572416 | 38931 | 4593 | 2207 | 615940 |

Ringer reported197229tokens, equal to total uncached input plus output across those attempts. Raw repeated diffs inflated context; future worker prompts require narrow reads/diffs, bounded output and no broad repository scans. No cost or remaining quota is inferred from these numbers.

## Independent Gates

- Migration18tests exit0 plus reviewer migration contract exit0.
- Foundation3tests exit0 and build exit0.
- Host adapter initial reviewer gate4failed/4: true global restricted state, nonpersistent deferred loading, core Workspaces API and actual-load readback. These findings must be corrected before deploy.
- No production managers replaced at this snapshot.
