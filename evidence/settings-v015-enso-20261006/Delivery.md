---
author: Codex
observed_at: 2026-10-06T15:58:57.772Z
status: ROOT_RELEASE_VERIFIED
environment: ENSO desktop
version: 0.1.5
history: true
---

# Manager Settings delivery

Observaciones de esta entrega, 2026-10-06, Codex. Los recibos son evidencia histórica de este scope; una operación posterior necesita verificar de nuevo el estado vivo y obtener su propio grant.

Manager 0.1.5 quedó instalado, habilitado nativamente y cargado en ENSO. El build marker y los tres hashes coinciden con la candidata cuya interfaz fue aceptada visualmente en Sandbox. Root comprobó de forma independiente los archivos y el runtime y cerró el grant R2.

| Artifact | SHA256 |
| --- | --- |
| main.js | baed1c7026be103871c4f19beee51fcdbdf3889cac71e01a6f8daeb20f6fb2be |
| manifest.json | ce9b56f77804f83b24b62c3fce07383751200402adc741108842b5043ed10aeb |
| styles.css | 918ec84caa360cd4d6a7e79564685203ec0041384a14115c4137f8aa1b5a671b |

State, Local raw, pausa de carga tardía, perfiles y filtros permanecieron exactos. Omnisearch siguió descargado y sin autostart nativo. Los 42 archivos vigilados, incluidos workspace y las dos ausencias legítimas de configuración, quedaron iguales. Settings2 permaneció abierto en community-plugins; se conservaron sus objetos, layout, buffers, leaf, foco y las instancias de otros plugins.

La ejecución nativa comenzó a las 15:58:41.246 UTC y terminó a las 15:58:43.702 UTC. El release durable se escribió a las 15:58:57.772 UTC, antes del totalBy 16:01:41.182 UTC. Se hizo un único Begin y se consultó el mismo job. Todos los controles, recibos y backups se escribieron fuera del vault durante el grant. La publicación ocurrió después del cierre de root. No se publicaron los backups State/Local ni el workspace completo.

El intento anterior 46df fue NO_START: el guard conservaba un State undefined en otro closure del REPL. No hubo first-action, backup, native call ni escritura de artifacts. Ese error permanece en su recibo separado. El nuevo controller utiliza un module factory con State compartido y fue comprobado con filesystem, transporte y reloj simulados antes del nuevo grant. La prueba también verifica escritura durable antes de dispatch, rechazo de Begin duplicado, pins alterados y plazos vencidos.

## Evidence

- [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-v015-enso-20261006/root-verification]] - Confirmación de root, hashes publicados y límites de aceptación.
- [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-v015-enso-20261006/R2/result]] - Resultado nativo SETTLED.
- [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-v015-enso-20261006/R2/release]] - Readback de 42 archivos y cierre durable dentro del plazo.
- [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-v015-enso-20261006/R2/controller-v2-cpu-proof]] - Prueba CPU del controller; cero llamadas nativas y cero tests de producto repetidos.
- [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-v015-enso-20261006/NO_START46df/no-start]] - Fallo previo conservado sin sobrescritura.
- [[Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/evidence/settings-v015-enso-20261006/preparation-history]] - Snapshots previos con fecha, autor, contexto y SHA; son historia de preparación, no pins ni decisiones vigentes.

La captura visual de los switches y la toolbar corresponde a Sandbox R4. Esta entrega ENSO preservó el tab de Settings existente y no realizó capturas ni clicks. El siguiente arranque y la aceptación mobile siguen sin comprobar dentro de este scope.
