# Manager 0.1.6 Acceptance

2026-10-07, Codex. Observaciones de esta entrega, limitadas a las pruebas y superficies indicadas. Los resultados históricos R1/R2 y cleanup se conservan con sus fallos originales; no acreditan esta aceptación ni se sobrescriben.

## Product

Versión 0.1.6, producto commit 82d7903. La lista de Manager se abre mediante el comando manager-view o el ribbon en un diálogo propio. Community plugins conserva su lista, sidebar, métodos y comportamiento nativos. Los ajustes propios reutilizan pestañas compactas, header cards, secciones y controles de Better Manager Companion 0.5.0, con estilos limitados al namespace de Manager.

La acción manual sobre un plugin permite cambiar ese target durante la pausa ordinaria de automatización, conservando la pausa y los perfiles. Los controles comprueban el estado real al terminar y muestran el motivo cuando una protección o una recuperación pendiente impide la acción. La desactivación manual de Manager entrega el unload a Obsidian dentro de la cola, sin guardar ni refrescar después de dispose. Las protecciones frente a perfiles y automatización se conservan.

## Source Verification

- Suite completa: 395/395 PASS. Build TypeScript/esbuild 0.1.6: exit 0.
- Regresiones causales de pausa manual, deferred, archive, self-disable, Settings nativo, lifecycle de diálogos y CSS limitado a las superficies propias.
- Reviews independientes cerrados después de corregir los findings de archive, UI y lifecycle. Los checkers no sustituyen la prueba nativa.
- Producto congelado: main.js bf1d245660349e4f1f4578a38a4563eee15bd5a5833c12639468d75aff201223; manifest.json 1d08012e04dfbd2edeaf5833813af8101afdb7438c9d220019ec39b97f7567c4; styles.css c5b8a3d5fd8250e3fd1156325164aaab83db70d0a68ff31cbc126be691cbf95a.

## Sandbox Verification

ROOT aceptó visualmente la lista propia y las páginas Deferred y Settings, con ocho pestañas visibles, cards y controles legibles. Capturas reales en el historial CUA de ROOT; no hay PNG guardado. Las otras páginas no se presentan como inspeccionadas visualmente. El helper funcional sólo mide geometría y mantiene pixelsVerified=false; la aceptación visual procede de esta sesión CUA separada.

Ejecución única manager016-functional-save-20261007, token 4aac136e-5413-48ec-8c00-b6b888975fca. Receipt SETTLED, pending=false, 2026-10-07T11:39:51.666Z. Los checkboxes reales de la fixture hicieron OFF/ON/OFF y cada lectura coincidió en loaded/native/desired. Manager se desactivó desde su propio checkbox, con writesAfterUnload=false, y la API nativa volvió a cargar una instancia nueva 0.1.6.

Readback independiente ROOT a las 11:45:49.788Z: functionalAccepted=true; Manager cargado; fixture ausente; State y Local byteexactos; configuración nativa igual al disco; Settings, plugins ajenos, core, ventanas, active leaf, layout y buffers iguales. Ningún cambio en archivos ajenos. El único delta esperado es el informe efectivo nuevo sin fixture, SHA d6793e41bc85c0e398bb50712d6a27a203e107dff380f795ef0033adae72d608. No se reanudó automatización ni se aplicaron perfiles.

El primer intento funcional falló porque enablePluginAndSave devuelve antes del guardado diferido de Obsidian. Se conservó su receipt; se revisó el contrato real de requestSaveConfig.run y saveConfig, se retiró la fixture en una unidad autorizada y el helper corregido obtuvo review y nueve casos CPU antes de la ejecución final. El fallo original sigue documentado en NativeR1 y los receipts R2/cleanup.

## Delivery Checklist

- [x] Implementación, build y 395 checks.
- [x] Sandbox cargado 0.1.6 y revisión visual acotada.
- [x] Toggles reales, self-disable, reactivación explícita y cleanup propio.
- [x] Readback independiente y preservación de estado.
- [ ] ENSO: ROOT mantiene HOLD de entregas durante el reparto de tres Sandbox y la migración Tasks. La observación filesystem previa encontró 0.1.5 y perfil OFF; no se escribió ni se activó ENSO. La próxima entrega necesita una baseline actual y coordinación del writer; no restaurará datos históricos.
- [ ] Siguiente arranque y mobile: fuera de la aceptación ejecutada. No se acredita runtime ENSO ni dispositivo a partir de Sandbox.

Receipts editables: [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-separation-20261007/native-functional-final-result]], [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-separation-20261007/native-functional-final-root-closure]], [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-separation-20261007/native-visual-root-closure]].
