# Manager 0.1.6 Native Plan

2026-10-07, Codex. Procedimiento preparado para la instrucción humana de separar la lista de Manager de Settings, reutilizar el estilo de Companion, corregir toggles y permitir desactivar Manager. Este documento describe una ejecución pendiente; las pruebas CPU no acreditan aceptación en Obsidian.

## Frozen Candidate

Producto: commit 82d7903, versión 0.1.6. Tres archivos y sus SHA-256 están en candidate-v016.json. Build y 395 pruebas aprobados; no se repiten mientras esos bytes permanezcan iguales.

Los módulos checks/settings-separation-native-20261007.mjs y checks/settings-separation-controller-20261007.mjs se importan sin acciones del host. El controller comparte una única closure para Begin, Guard y Poll. El helper emitido se compila íntegro antes de dispatch. Control y first-action se crean exclusivamente y se sincronizan a disco antes de la primera llamada nativa.

## Authorized Actions

1. Obtener un grant nuevo de ROOT con executor, token, identidad física Sandbox, appId/window/webContents/document, baseline actual y preimages. ACK antes de preflight, primer acto antes de 15 segundos, acciones antes de 120 y cleanup antes de 180, siempre limitados por el deadline absoluto de ROOT. No se reutilizan tokens ni identidades históricos.
2. Comprobar Manager cargado y pausado por late load, Settings cerrado, buffers/layout/plugins ajenos estables y ausencia de la fixture reservada tanto en disco como en catálogo, State, loaded y configuración nativa.
3. Guardar backups privados fuera del vault. Congelar buffers aprobados de Manager y fixture antes de cualquier await. Descargar sólo Manager, copiar sus tres artifacts contra preimages y cargar 0.1.6 conservando State/Local y profiles.
4. Crear únicamente aigility-manager-toggle-fixture, activarla con la API nativa y realizar OFF/ON/OFF mediante los checkboxes de la ventana propia. Leer loaded/nativeAutostart/desired después de cada acción; no reanudar automatización ni aplicar perfiles.
5. Abrir y cerrar lista y opciones propias, comprobando estructura y geometría. El helper no usa Electron capturePage: pixelsVerified permanece false. La aceptación visual requiere una sesión CUA posterior, con Raise y screenshot real, bajo el grant correspondiente.
6. Desactivar Manager mediante su propio checkbox, comprobar unload/dispose sin escrituras posteriores y volver a activarlo explícitamente por la API nativa. Verificar instancia nueva 0.1.6.
7. Retirar sólo el record de la fixture dentro de la cola y contra el State/Local conocido. Eliminar sus tres archivos por hash y su manifest/counter propios. Restaurar únicamente la posición original de Manager en el Set nativo de forma síncrona; ningún plugin ajeno recibe enable/disable.
8. Restaurar los bytes originales de community-plugins.json sólo contra el postimage conocido de la fase propia. Conservar un effective-state.json nuevo sin fixture y registrar su hash. No restaurar ese informe desde backup. State/data.json y Local deben terminar byteexactos; profiles y automatización siguen como estaban.
9. Verificar métodos y nodo de Community plugins, Settings, plugins/core ajenos, buffers/layout y baseline. Escribir receipt durable SETTLED con pending=false. Cualquier conflicto queda FAILED_PRESERVED; se conserva evidencia y estado, sin retry, rollback automático ni nuevo job.

## Review Gates

- [x] Buffers inmutables antes de await y copia sólo desde esos buffers aprobados.
- [x] Guardas de postimages conocidos entre fases, cleanup condicionado y ningún backup de effective sobre cambios concurrentes.
- [x] Fixture referenciada en State rechazada antes de backup y de cualquier acción.
- [x] Cinco casos CPU sobre el helper emitido: normal, fuente cambia después del preflight, record preexistente, effective concurrente y community concurrente.
- [x] Controller real compilado y probado: ACK/first-action, una closure, forwarding de identidad/fixture, Begin único, deadlines y pins.
- [ ] Peer re-review de los tres findings - solicitado al owner de modelos; no habilita START hasta PASS.
- [ ] Grant y ejecución Sandbox - pendiente de review cerrado e identidad actual proporcionada por ROOT.
- [ ] Pixels reales y aceptación visual - pendiente de CUA bajo su ventana coordinada.
- [ ] Entrega ENSO - después de Sandbox; nueva baseline y grant. La última observación ROOT encontró Manager ausente del runtime: se preserva ese perfil y no se infiere activación a partir de Sandbox.
