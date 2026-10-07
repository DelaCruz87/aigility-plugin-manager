# Fixture Containment Plan

2026-10-07, Codex. La unidad functional-current terminó FAILED_PRESERVED en fixture-native-enable antes de pulsar controles. ROOT comprobó q.task completada y preservó los cambios concurrentes de workspace, con causa no atribuida. La fixture propia está cargada/nativa ON, su contador vale 1 y State/Local permanecen iguales. El grant siguiente se limita a retirarla; no reabre la prueba funcional.

La implementación nativa actual de enablePluginAndSave espera enablePlugin y llama requestSaveConfig sin esperar la escritura de configuración. disablePluginAndSave también solicita ese guardado diferido. La lectura inmediata del helper rechazó ese desfase; la lectura posterior coincidió en miembros y orden. Estos hechos provienen del prototype actual del host, no del wrapper de Manager ni de una nota histórica.

El helper de cleanup valida identidad física actual en cada gate, State/disk/Local, baseline actual, plugins/core ajenos y superficies. Congela la instancia y manifest de la fixture, comprueba ON/counter1/los tres hashes antes y después de esperar la task previa, y comprueba OFF/manifest/ausencia de replacement después de cada await y antes de eliminar archivos. Un cambio de ruta activa o replacement conserva el estado y detiene la operación.

Los backups privados, su directorio y padre se sincronizan antes del disable. La única desactivación es la fixture. requestSaveConfig.run ejecuta su escritura pendiente; no se usa cancel. Se comprueban identidad y source hashes de ambos hooks antes/después de awaits, después se espera explícitamente saveConfig y se verifica el postimage conocido. Se eliminan únicamente los tres archivos aprobados, manifest y contador propios. La restauración de community raw exige el postimage conocido; el resumen efectivo se regenera mediante la API existente sin fixture. El receipt y su directorio se sincronizan a disco.

Controller y dispatch conservan una sola closure Begin/Poll, ACK durable antes de preflight, first-action antes de 15 segundos y límites absolutos 120/180 acotados por ROOT. Control declara sólo contención. Un resultado FAILED_PRESERVED termina el polling y exige cierre ROOT; no hay nuevo job ni rollback automático.

- [x] Helper, controller y dispatch emitidos/compilados completos sin I/O nativo.
- [x] Findings de lectura del root capturado y replacement durante await corregidos en source.
- [x] Peer re-review de bytes finales y reproducciones - PASS_PREPARED_CLEANUP_SOURCE de helper 3dabd9e0, controller b1fcb7c5 y dispatcher 3f5170aa. Normal y dos fault cases comprobados independientemente.
- [x] Grant ROOT de cleanup - token 2b073626, primer ACK 11:27:37.926Z después de repinar el snapshot actual sin Begin previo.
- [x] Fixture retirada y cierre ROOT - receipt SETTLED 11:27:38.223Z, ROOT RELEASE 11:29:19.783Z. Fixture ausente en disco, manifest, native, loaded y counter. State/Local raw y community original iguales, resumen efectivo nuevo sin fixture. No equivale a aceptación funcional de los toggles.

El cierre ROOT detectó un crash de la ventana ajena 9/wc11 frente al snapshot anterior. Sandbox 2/wc2 seguía sano. El helper conservó objetos y número de ventanas, pero no comparaba el flag de crash de ventanas ajenas. Su causa y momento no están atribuidos; foreignWindowIntegrityAccepted=false y el cierre global no se presenta como PASS. Se conservó esa ventana sin recovery ni acciones globales. El siguiente helper funcional compara los flags capturados de cada ventana, incluidos los ya crashed.
