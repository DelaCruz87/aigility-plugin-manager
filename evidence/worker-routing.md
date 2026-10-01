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

## Free Route Review - 2026-10-01 13:27 Madrid

Coordinador de modelos confirmó acceso a OpenCode Space Bunny gratuito mediante una extracción sintética. El proyecto usó una configuración local con wrapper Seatbelt y flags actuales, sin fallback API facturable. Los eventos OpenCode cost suman 0; no se infiere saldo ni disponibilidad futura.

| Unit | Requested model | Check | Duration | Review |
| --- | --- | --- | ---: | --- |
| adapter-free | opencode/space-bunny-free | PASS attempt1 | 479.1s | 23 owned +4 independent tests; revisión añadió caso manual concurrente y falló4/5 |
| adapter-concurrency | opencode/space-bunny-free | PASS attempt1 | 371s | 24 owned +5 independent tests aprobados; supresión limitada a invocación sincrónica |

Los contadores agregados por step_finish del primer run: input51173, output18349, reasoning25845, cache.read2842426, total2937793; segundo run: input29658, output17200, reasoning0, cache.read1141888, total1188746. Son campos del engine, no cuota restante. No se equiparan automáticamente a los tokens agregados de Ringer ni a contadores Codex. El primer run Ringer publicó83651 tokens.

Z.ai devolvió primary5h usedPercent0 después del reset13:10:47Madrid; UI-controls volvió a glm-5.3-flash con max_parallel1. Antigravity sigue sin recuperación confirmada. Runtime/Advanced/debug/harness usan workers Luna6 ya autorizados. No se reinician los runs originales sólo porque notes.md quedó fuera del scratch: pruebas20/14 pasaron, aunque el deliverable gate marcó FAIL. Integration4tests iniciales pasaron pero su typecheck falló en módulos en curso; no acredita build integrado ni despliegue.

Los checks independientes integrados ahora prueban ManagerRuntime y DebugManager reales juntos. La pausa de automatización no puede impedir las mutaciones de una sesión de diagnóstico explícita. Estas dos pruebas siguen pendientes de reparación del contrato entre módulos.


## Current delivery review - 2026-10-01 15:56 Madrid

Codex distingue checks, archivos entregados y ejecución real. UI-final Free PASS2/1111.2s, revisión posterior 58 pruebas; debug-active Free PASS1/170.7s, 29 pruebas incluyendo contratos integrados. Commands-preview Luna PASS1/195.9s,10 pruebas/build. Dynamiccommands Luna timeout450s entregó fuente, pero renombrado falló por stub incompleto; dynamic-correction Luna PASS1/173.3s corrige stub del host y alias community.

El instalador Luna sí instaló Sandbox 0.1.0 y conservó el estado ajeno. Su checker repetido rechazó --run por receipt previo y terminó FAIL. Lectura independiente confirma instalado, habilitado y cargado; los tres archivos de build y cuatro backups coinciden por hash. data.json fue serializado por runtime y se verificó su migración canónica separadamente. No constituye aceptación funcional.

Community-Free FAIL600s por código inyectado try sin catch, antes de cualquier escritura. Dos unidades Luna amplias no entregaron corrección: una interpretó la advertencia de bootstrap como aprobación de todo archivo; otra agotó450s planificando limpieza. Community-syntax Luna-medium PASS1/43.4s corrige parse, compila antes de enviar al host y --prepare real confirma46 community/30core, fixturesausentes y runExecutedfalse. Los intentos anteriores no se cuentan como pruebas nativas.

Global-prepare GLM5.3Flash se detuvo por ambigüedad de billing a139.7s; global-plan GLM5.3 agotó450.6s sin entregar script ni receipt. Ambos emitieron unrecognized_model para generate_session_title; no se atribuye automáticamente ese warning secundario a rechazo de la generación principal. Coste no expuesto; no inferencia de importe0. Coordinador verificó que las keys con etiquetas históricas Credit-Hermes y Coding Plan-Codexbar corresponden al mismo registro Coding Lite V2 VALID/inCurrentPeriod=true, renovación Sep14-Oct14, cuota compartida. La documentación primaria de Claude Code usa el endpoint Anthropic como ruta Coding Plan: [Z.ai Coding Plan](https://docs.z.ai/devpack/tool/claude). No se cambió el engine global y las configuraciones locales suprimen todos los fallback engines.

La CLI agy models lista gemini-3.8-flash-low/medium/high. Coordinador acredita checks recientes por3.8Flash-low; se usa config propia explícita y fallback vacío para una preparación pequeña de cleanup, sin operaciones globales.


## Archive source delivery - 2026-10-01 18:32 Madrid

Usuarios autorizaron Ringer GLM5.3/5.3Flash, agy Gemini3.8Flash y Codex Luna6. Unidades acotadas, sin fallback facturable configurado; ninguna prueba nativa ejecutada por estos workers.

| Unit | Route | Observed result | Independent review |
| --- | --- | --- | --- |
| archive-backend | GLM5.3Flash | Timeout420s, sin archivos | No acredita backend; warning de session_title no prueba rechazo del modelo principal |
| archive-ui | agy Gemini3.8Flash-low | Entregó módulo UI | Luna corrigió contrato de runtime; 7 pruebas reales de filtros/paginación/actions pasan |
| archive-backend-agy | agy Gemini3.8Flash-low | Timeout4m, sin archivos | No acreditar entrega por texto SUCCESS ni exit0 |
| archive-engine-luna / fixes | Codex Luna6 | Backend entregado y reparaciones acotadas | 12 pruebas independientes; Sync usa instancia real/filter Set, journal, generación y protección revalidados |
| archive-integration / fixtures | Codex Luna6 | Runtime, adapter, GitHub y perfiles integrados | Pruebas conjuntas con runtime real; parciales sólo restauran miembros declarados compatibles |
| archive-ui-beta-guards / final-refresh | Codex Luna6 | Guardas y refresco UI entregados | 2 guardas GitHub reales; índice desactualizado detectado antes de instalación y dentro de rollback en cola |

El primer backend compilable falló checks independientes de Sync, protección, recuperación y prefijo de transacción. Se repararon esas condiciones por Ringer y se conservaron los casos. Errores iniciales de loader/test UI (ruta extensionless, count6 y orden de pestañas) se corrigieron en los checks, contrastándolos con la UI real de7secciones. Última suite263PASS/build exit0. Ninguna carpeta real trasladada, ningún despliegue del archivo, ninguna escritura iPad.

## Requested archive path - 2026-10-01 19:06 Madrid

Ringerarchive-path-v011 GLM5.3Flash PASS1/177.6s, ocho archivos exactamente scoped. Ruta _archive ymetadata0.1.1 comprobados por checker;263tests/build0. El warning de generate_session_title no impidió entrega. Ringeroutput4440tokens; modelUsageinput59244/output4889/cache354176/costUSD0.595533/costBasisunknown son métricas declaradas, no factura. Sin pruebas nativas ni operaciones Sync/iPad.
