# AIgility Plugin Manager

AIgility Plugin Manager es un plugin beta de Obsidian que reúne plugins community, core, perfiles de dispositivo, arranque diferido, recuperación, gestión de versiones y debugging reversible. El estado duradero del gestor se guarda en [data.json](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/data.json); el estado operativo y los backups de migración permanecen en la configuración local del vault.

## Features

- Gestiona plugins community y core instalados desde la pestaña de ajustes de AIgility Plugin Manager, con búsqueda, tags, grupos y un catálogo compacto.
- Permite crear y aplicar perfiles completos de dispositivo y perfiles parciales de fixture. Los comandos de perfil usan `manager-profile-ID-apply`; los comandos de fixture usan la misma forma de ID.
- Vincula localmente un perfil al app de Obsidian actual. Las plantillas cubren `macbook`, `zenbook`, `iphone`, `ipad`, `s24`, `lenovo tab` y `boox tab mini c`. La vinculación no se copia entre dispositivos.
- Excluye los plugins deferred del arranque nativo y los carga con una agenda cancelable cuando el gestor confirma que el arranque es seguro.
- Ofrece recuperación explícita de operaciones interrumpidas. Recovery, Restricted Mode, carga tardía y una sesión activa de debug suspenden la automatización. Si Companion sigue cargado, muestra una advertencia y pausa la automatización; la migración no desactiva los gestores anteriores.
- Permite consultar releases y prereleases de GitHub, fijar versiones, instalar versiones validadas y revertir los archivos del plugin conservando [data.json](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/data.json).
- Ejecuta debugging reversible de plugins, comprobaciones por parejas e integración opcional con Advanced Debug. Una sesión de debug interrumpida requiere recuperación manual y no reaplica automáticamente su snapshot anterior.
- Mantiene el informe de estado efectivo y los backups de migración en el directorio local del plugin. Los campos que parecen credenciales se redactan recursivamente antes de serializar el estado del gestor.

## State vocabulary

El gestor presenta cuatro hechos separados para cada plugin:

- `installed` - hay un paquete de plugin en el vault.
- `desired` - estado objetivo guardado por el gestor.
- `nativeAutostart` - preferencia de arranque persistida por Obsidian.
- `loaded` - una instancia está cargada en esta sesión de la app.

Estos valores pueden diferir durante el arranque diferido, la recuperación o los cambios manuales. [effective-state.json](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/effective-state.json) también muestra agenda, versión y motivo; no contiene credenciales.

## Device binding

Las plantillas asocian los equipos desktop con `macbook` y `zenbook`, los equipos mobile con `iphone` y `s24`, y las tablets con `ipad`, `lenovo tab` y `boox tab mini c`. El perfil solo se aplica al inicio después de vincularlo localmente. Una carga tardía omite la automatización de inicio. El gestor no deduce el dispositivo físico por su nombre; selecciona el perfil correspondiente en Manager Options.

## Migration and recovery

En la primera carga sin `schemaVersion: 1`, el gestor lee los datos de Better Plugins Manager y Companion y observa los plugins instalados y el estado core actual. Antes de escribir el estado integrado, guarda los datos legacy originales y los archivos de configuración community/core mediante el vault adapter en [migration-backups](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/migration-backups/). Estos backups son material local de recuperación y no forman parte de este repositorio.

La migración conserva los ajustes fuente y nunca desactiva los gestores anteriores. Si Better Manager Companion está cargado, AIgility muestra una advertencia y pausa las acciones automáticas. Revisa esa advertencia y usa el procedimiento de despliegue dedicado a Sandbox antes de retirar los plugins legacy. Para recuperar, inspecciona Manager Options y [effective-state.json](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/effective-state.json), resuelve la causa y ejecuta `manager-resume`. No reemplaces el estado del gestor por un snapshot previo de debug.

## Beta installation and rollback

Ejecuta `npm run build`; instala el plugin compilado en Obsidian Sandbox primero y valida perfiles, toggles core, exclusión deferred, recovery, rollback de releases y debugging allí. El despliegue a ENSO se considera después de aceptar Sandbox. Conserva una copia de los archivos instalados y el backup local de migración antes de actualizar una beta. El rollback de GitHub restaura los archivos de release que administra y deja [data.json](file:///Users/eme/Obsidian/ENSO/.obsidian/plugins/aigility-plugin-manager/data.json) intacto. Un checkout del repositorio fuente no demuestra que el plugin esté instalado ni que la UI se haya renderizado en Obsidian.

## Debugging

Inicia debugging desde la UI del gestor después de seleccionar candidatos compatibles. La sesión registra el estado original, los cambios propios y los valores esperados tras esos cambios. La restauración omite entradas modificadas manualmente después del experimento. Advanced Debug se integra bajo demanda y no se habilita como plugin independiente permanente. Si Obsidian se cierra durante una sesión, la siguiente carga muestra el aviso de sesión interrumpida y requiere una acción de recuperación manual.

## Commands

- `manager-options` - abre las opciones de AIgility Plugin Manager.
- `manager-apply-profile` - aplica el perfil vinculado a esta app de Obsidian.
- `manager-undo` - revierte la última aplicación de perfil si sus valores posteriores siguen coincidiendo.
- `manager-resume` - reanuda después de resolver una condición de recovery.
- `manager-profile-ID-apply` - aplica un perfil de dispositivo específico o un fixture con ese ID.

El plugin registra mappings de comandos legacy de Better Plugins Manager cuando puede observarlos. No edita los hotkeys de Obsidian ni los archivos de configuración de otros plugins.

## Development

Ejecuta `npm run build` para comprobar tipos y generar el bundle de producción. Ejecuta `node --test tests/integration.test.mjs` para las pruebas de integración del ciclo de vida. Los módulos runtime tienen tests enfocados en `tests/`; el paquete no declara aceptación en Sandbox ni en dispositivos físicos hasta ejecutar esas comprobaciones en el host de destino.
