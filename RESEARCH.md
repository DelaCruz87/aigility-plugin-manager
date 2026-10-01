# Community Manager Research

Date: 2026-10-01. Author: Codex. Context: implementación del plan AIgility Plugin Manager aprobado por Eme. Las observaciones describen las fuentes consultadas en esta fecha; los cambios upstream requieren revalidación. Los requisitos aprobados permanecen en SPEC.md.

## Findings and choices

| Source | Observed capability | Integrated choice and alternative |
| --- | --- | --- |
| [Lazy Plugins source](https://github.com/alangrainger/obsidian-lazy-plugins/blob/main/src/main.ts) | Excluye IDs diferidos con disablePluginAndSave, los carga después con enablePlugin y añade un intervalo breve entre plugins. Su README describe limitaciones al observar cambios manuales nativos. | Incorporar la carga sin persistencia y el escalonamiento sencillo. Añadir seguimiento de generaciones, pertenencia al perfil y cancelación en recuperación. Se descarta adoptar su propietario de estado desktop/mobile separado porque el plan exige un motor único. Los plugins normales conservan el arranque nativo. |
| [BRAT developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md) | Los assets de release proporcionan manifest/main/styles; admite tags fijadas y selección de la última versión con prereleases. Describe comparación semver e identidad de release/manifest. | Usar assets, selector explícito y pin. Comprobar identidad/compatibilidad antes de sustituir archivos, preservar data.json y conservar rollback. Se descarta retener historiales completos para todo el catálogo: la consulta ligera sigue acotada. Seguir betas también permite una versión estable posterior, comprobado por un contrato independiente. |
| [Bulk Plugins Manager README](https://github.com/kemus/obsidian-bulk-plugins-manager/blob/master/README.md) | Mitades, deshacer y mitad complementaria acotan un fallo. La restauración respeta plugins apagados manualmente desde la captura inicial. El fork conserva documentación histórica Divide & Conquer. | Mantener mitad/complemento/anterior, añadir experimentos individuales y por parejas, persistir pasos y restaurar sólo estados posteriores y generaciones propios que sigan coincidiendo. Se descarta la restauración completa incondicional porque reactivaría plugins apagados manualmente. |
| [Advanced Debug Mode README](https://github.com/mnaoumov/obsidian-advanced-debug-mode/blob/master/README.md) | Debug mode, trazas de callbacks, async en desktop, timeouts, DevTools móvil y abort compartido. Las trazas async tienen restricciones desktop y alteran la autocompletación de consola mientras están activas. | Integrar la implementación upstream fijada bajo demanda, conservar límites por plataforma y teardown, y suspender el plugin independiente mientras estos hooks están activos. Se descartan parches siempre activos porque alterarían la operación cotidiana y permitirían hooks duplicados. |

## Local host evidence

Se inspeccionó Obsidian 1.14.3 junto al Sandbox vivo. app.plugins.isEnabled() consulta el permiso global de carga, sin argumento ID. Los wrappers core enable(false)/disable(false) cambian el estado nativo y instance._loaded. Community enablePlugin/disablePlugin conserva la lista nativa. La instancia core Workspaces posee la carga de workspaces.

Los checks independientes ejecutan estas diferencias y el contrato runtime/diagnóstico integrado. Las pruebas aisladas no prueban la interfaz renderizada, el siguiente arranque ni aceptación física. El receipt Sandbox debe mostrar las aserciones ejecutadas y la conservación del estado ajeno.

## Provenance and cleanup

El fork conserva el historial Git y licencia BPM. Las fuentes Companion se registran en licenses/companion-provenance.md; no se inventa una licencia distinta. Advanced Debug y sus dependencias conservan atribuciones y licencias. Usar un comportamiento como referencia no implica copiar código de cada proyecto comparado.

Las traducciones README y capturas anteriores de BPM son material histórico marcado. Sus recomendaciones de takeover global no gobiernan el motor integrado. La limpieza abarca este fork y su runtime entregado, conservando las notas ajenas y su historia.
