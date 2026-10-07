# Commander Restore Runner Review

2026-10-07, Codex. Preparación solicitada por ROOT dentro de la creación de tres Sandbox con plugins operativos. Este bundle es una herramienta de mantenimiento; no modifica producto Manager ni fuente Commander. Ninguna ejecución nativa de instalación ha ocurrido.

## Routing and Ownership

Ringside se abrió antes de spec/check. Manifest lint clean. Owner-models seleccionó glm-plan/glm-5.3, 240s, un intento, sin fallback. No se despachó: el wrapper usa una credencial API Credit y no hay grant de gasto. ROOT autorizó expresamente al writer existente a implementar esta unidad directamente, sin modelo nuevo ni reparación de proveedores. La ruta solicitada y la ruta efectiva quedan diferenciadas; API calls=0 en esta preparación.

Archivos propios: runner/commander-restore-native.mjs, runner/commander-restore-dispatch.mjs, este informe, checks/commander-restore-cpu-20261007.mjs y checks/prepare-commander-restore-20261007.mjs, más documentación y evidencia de este bundle. No se editaron otros plugins, bootstrap, datos de vault, Sync ni dispositivos.

## Preservation Contract

Sólo copia main.js, manifest.json y styles.css desde buffers aprobados a cmdr en cada Sandbox. La comparación de cada buffer con su SHA ocurre antes de cualquier backup o write. Mantiene datos/configs raw y native flags/order. Carga sólo Commander mediante loadPlugin, sin enable/disable AndSave, saveConfig, global loadManifests, restart, foco ni acciones UI. El guard previo rechaza configuraciones que dispararían migraciones de Commander o macros de startup.

Obsidian añade dir al manifest registrado: se admite únicamente el valor esperado .obsidian/plugins/cmdr o el target completo y se comprueba igualdad semántica de todos los demás campos. No se cambia el manifest cache. Settings abiertos en Sandbox 2/3, popup windows, plugins/core ajenos, layout, buffers, activeLeaf y foco se capturan y se conservan. Un renderer ajeno ya caído se acepta sólo con su flag capturado; no se recupera.

Backups privados de las configs y own3 de todos los targets, con fsync de archivos/directorio/parent, preceden el primer lifecycle. Cada target guarda además su baseline antes de copiar. Copia con preimage/postimage checks y readback. Un cambio durante await falla y conserva el estado; no restaura backups automáticamente. Receipt terminal usa el plazo de cleanup y requiere cierre independiente de ROOT.

## Verification

Checker ejecutado sobre funciones emitidas, en filesystem y realms simulados: nueve casos inner PASS (normal, identidad errónea, config preimage, foreign ya crashed, data race, source race, deadline, foreign crash nuevo, buffer de segundo read alterado). Dos ACK inválidos del dispatcher real se rechazan antes de control/CLI. Outer real alcanza su preflight con require(vm) explícitamente rechazado por el mock. Total 12 comprobaciones PASS; no I/O nativo de instalación ni suite de producto.

Node compila la función inner/outer íntegra y el dispatcher. En dispatch, Node compila las tres invocations reales enriquecidas con token/deadlines/pins y el outer real antes de escribir ACK/control; guarda actual-emissions.json y actual-compilation.json. El renderer consume strings congelados y comprueba sus hashes, sin require(vm). ACK requiere fecha finite, futura y token no vacío. Begin único, primer acto antes de ACK+15s, acciones ACK+120s y cleanup ACK+180s, limitados por hard deadline. Poll SAME; UNKNOWN/fallo no crea otro job.

El primer readonly prepare se detuvo por dir de manifest; el segundo por resolución de URL con espacios. Se conservaron sus logs, se corrigió cada causa y no hubo lifecycle ni target writes. La lectura fresca posterior a ROOT Filetree/orphan closure observó Commander unloaded/native ON en los tres Sandbox, cinco ventanas healthy y Settings abiertos en 2/3. La ausencia actual de la ventana ENSO no se atribuye a este runner. Paquete provisional final: cmdr3-ready-LlFtZG, loadedSHA9893f9a8bf94e14282f4948749bd617a4ff80823bc048d4d02922b06f6ebef34, protected configs145. No control ni first-action.

## Commands

Comandos desde la raíz del repo, con lectura nativa sólo bajo permiso ROOT de preparación:

```sh
node --experimental-vm-modules checks/commander-restore-cpu-20261007.mjs evidence/commander-restore-20261007/runner
node checks/prepare-commander-restore-20261007.mjs
```

El preparador devuelve un path privado fuera del vault. Allí guarda native.json, candidate buffers, baseline.json, source congelado, loaded.json y compile-proof.json. ROOT valida ese paquete y emite un grant nuevo que nombra job, owner, loadedSHA, ackBy, absoluteHardDeadline y token. Sólo entonces se ejecuta el dispatcher congelado con --begin y el path del paquete. No sustituir por el source mutable del repo ni reutilizar un grant anterior.

## Live Checklist

- [x] Ownership, spec, checker y manifest registrados.
- [x] Ruta API triada, sin gasto ni llamada modelo; excepción del writer autorizada por ROOT.
- [x] Implementación, fixes focales y 12 comprobaciones CPU.
- [x] Lectura nativa de preparación y compilación completa del paquete.
- [x] Peer delta final: PASS_FOCAL_STATIC_AND_CPU, 12 checks privados y cero findings nuevos; reporte preservado en peer-final-review.json.
- [x] Primer grant y Begin únicos: token63abeb26, ACK12:42:28.620Z. Original own3 copiados y Commander loaded/native true; guard workspace-buffers falla12:42:34.364Z, sin acciones en 2/3. Receipt FAILED_PRESERVED conservado. ROOT cierre independiente12:45:54.783Z/RELEASE posterior, taskSettled true, 143/145 configs raw iguales. Cambios posteriores community/workspace y nuevo Open Brain se conservan, causa del FAIL no atribuida. Buffers hash igual; activeLeaf/layout distintos al diagnóstico posterior.
- [ ] Aceptación completa: no alcanzada por ese grant. ROOT autoriza una unidad nueva explícitamente limitada a 2/3, después del cierre, con allowlist de tres keys Commander del ribbon y todo el resto del layout/leaf/buffers estricto. No se reejecuta ni se restaura el original.

Los PASS anteriores acreditan preparación y checks simulados; no acreditan instalación ni funcionamiento real de Commander.
