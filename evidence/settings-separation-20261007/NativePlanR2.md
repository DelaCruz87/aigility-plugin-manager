# Functional Current Plan

2026-10-07, Codex. Preparación de una unidad funcional distinta después del cierre de R1. Manager 0.1.6 está cargado en Sandbox; la funcionalidad de los toggles sigue pendiente. El resultado R1 y el cambio concurrente de workspace se conservan con causa no atribuida.

## Scope

Modo functional-current: se comprueban versión/build y los tres hashes actuales contra el candidato aprobado. Se guardan backups privados, pero no se descargará, copiará, registrará ni activará inicialmente Manager. Controller y producto no cambian. La prueba comienza directamente con la fixture propia, OFF/ON/OFF y las superficies propias; después se comprueba self-disable y el re-enable explícito por Obsidian.

Se mantienen ausencia de fixture en State/catalog/config/disco, guards de plugins/core ajenos, Settings y buffers, known-post CAS entre fases, cleanup de record por cola y archivos por hash. State/data.json y Local raw deben terminar iguales. Community raw se restaura únicamente contra el postimage propio conocido y el informe efectivo generado se conserva actualizado sin fixture. No se aplican perfiles ni se reanuda la automatización.

## Diagnostic Changes

El guard de superficie conserva sus condiciones y distingue settings-instance, settings-open, settings-last-tab, settings-document, settings-modal, active-leaf, layout, buffers y windows. firstGuardFailure guarda el primer miembro y su fase, con snapshots de hashes e identidades; no guarda texto de notas. El receipt no atribuye la causa del cambio.

El dispatch resuelve el path físico de su entrada, admite import desde stdin sin ejecutarse, transmite mode al controller y termina al recibir FAILED_PRESERVED, manteniendo pending=true en su resumen. Esa terminación no sustituye el cierre ROOT ni habilita otro job. UNKNOWN sigue conservándose sin retry o rollback automático.

## Checklist

- [x] Siete escenarios CPU sobre el helper emitido, incluidos first-change active-leaf y modo current sin unload inicial, con un único load por el self re-enable explícito.
- [x] Controller existente y compilación completa de helper/controller/dispatch, sin llamadas nativas.
- [x] Review focal del delta - PASS_PREPARED_SOURCE_DELTA, owner de modelos. Helper 41f83a2e, controller 972c1d6f y dispatcher final 24eaf079. Siete casos, controller e import stdin verificados también independientemente; ejecución aislada del dispatch comprueba mode, una lectura FAILED_PRESERVED y salida durable pending=true. Aceptación de source preparado solamente.
- [ ] Observación y baseline nuevas - después del cierre de la sesión CUA de ROOT.
- [ ] Grant ROOT específico y ejecución única - sólo tras review cerrado; ACK/first-action y límites 15/120/180 absolutos como R1.
- [ ] Receipt y cierre ROOT - necesarios para aceptación funcional. Un fallo conserva estado/evidencia; no se retoma R1 ni se repite la instalación.
