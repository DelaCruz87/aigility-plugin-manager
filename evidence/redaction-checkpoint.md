## Identity redaction recovery checkpoint

2026-10-01 20:55 Madrid, Codex. Eme autorizó continuar el desarrollo y deploy con plugins/_archive. La observación propia de Sandbox20:45 confirma instalado/cargado0.1.0, target enso-secret-placeholders nativo y cargado, binding local sin asignar y debugging inactivo. Se comprobó un fallo del gestor: la detección de nombres de campos secretos confundía IDs de plugins con propiedades de credenciales. Se conservaron4archivos byteexactos antes de cambios; el inventario identifica46campos afectados:1record,21fixturemembers,2backupstates y22mapaslegacy. No afecta a notas ni se presenta como incidente de integridad del vault.

Fuente0.1.2 publicada enb7f6472. Redacción distingue claves canónicas y mapas de IDs planos pluginStates/githubSources, recorriendo sus valores para seguir ocultando credenciales reales. La regresión se ejecuta por onload, cola/save, refresh y list; cubre IDs que contienen secret/token/password, fixtures, snapshots, backups, fuentes GitHub y rawlegacy. Suite287PASS, buildexit0. La primera unidadLuna falló el checker tras ampliarse el caso con nuevos datos observados; la siguiente unidad acotada pasó92.5s. Son resultados de fuente, no deploy.

- [x] Corregir la causa y conservar pruebas que reproducen el fallo anterior.
- [x] Preparar reparación selectiva46campos desde los backups originales, manifest previo a migración y activación histórica contrastada con el host actual; no inventar booleanos ni restaurar State completo.
- [x] Comprobar que la propuesta sólo cambia campos dañados; valores válidos y propiedades ajenas permanecen iguales.
- [x] Corregir verificador: token distinto por fase, deadline host antes de cada mutación posterior a await, incluyendo rollback, y no reload con artifacts iguales.
- [ ] Ejecutar la unidad coordinada de reparación/deploy0.1.2 en Sandbox. READY offline99dedf5 requiere START de la ventana compartida; todavía no hay nuevas escrituras host.
- [ ] Aceptación funcional/visual y siguiente arranque. ENSO conserva sus gestores hasta completar esa evidencia.

La copia de configuración y la propuesta detallada están en local-backups ignorados por Git; las receipts publicadas sólo contienen hashes, rutas de campos, tipos y resultados. Si el preimage cambia o el target ya no está activo, la unidad rechaza la reparación y requiere releer el estado. Rollback revierte únicamente postimages propios coincidentes antes de recargar el binario anterior; conserva ediciones manuales conflictivas. No cambia Sync, perfiles ajenos ni archivos iPad.
