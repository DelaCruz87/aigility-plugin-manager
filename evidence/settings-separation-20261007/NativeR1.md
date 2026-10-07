# Native R1 Observation

2026-10-07, Codex. Resultado histórico de manager016-sandbox-20261007-r1. La invocación inicial con /var no entró en main porque Node resolvió import.meta.url a /private/var. ROOT comprobó ZERO_BEGIN y autorizó la entrada física del mismo runner/job/token, sin cambiar código ni crear otro job.

ACK durable 10:57:34.276Z, primera acción 10:57:34.290Z. El receipt original terminó FAILED_PRESERVED a 10:57:34.904Z durante load-candidate, con fixtureCreated=false y error Settings/window/layout/buffer changed. Se copiaron únicamente los tres artifacts aprobados y se cargó Manager 0.1.6. No se creó la fixture ni se ejecutaron toggles, self-disable o captura visual.

ROOT confirmó q.task completada y publicó RELEASE_VERIFIED. Se mantiene el receipt original pending=true como señal de fallo conservado; no indica que siga ejecutándose una escritura. El proceso propio de polling se detuvo mediante TERM antes de recibir la instrucción ROOT de esperar su deadline. Ese proceso salió con 143 y no produjo dispatch-return.json. No se detuvo Obsidian ni ningún otro proceso, ni se hizo rollback o retry nativo.

## Confirmed State

La lectura posterior y el cierre ROOT verificaron 0.1.6 loaded/native ON, los tres artifacts exactos, State y Local raw conservados, 34 plugins ajenos, 30 core y buffers iguales, y fixture ausente. La pausa por conflicto deferred/protection de omnisearch permaneció literal. El cierre ROOT detectó además un cambio de workspace.json posterior a la comparación inicial de 47 archivos; se conserva y su causa no está atribuida.

Entre la observación previa y la posterior cambiaron layoutHash, activeLeaf y el inventario de ventanas, con una nueva ventana about:blank. El guard agregado no guardó el miembro que cambió primero durante load-candidate. Esas observaciones posteriores no identifican el actor ni el momento exacto y no acreditan un defecto de Manager o una acción del usuario.

## Source Inspection

El unload de 0.1.5 restauraba sus hooks/sidebar/nodos ocultos de Settings. El guard posterior a ese unload pasó. El fallo apareció después de enablePlugin de 0.1.6. Su onload registra SettingsTab, comandos, ribbon y startup guards, y llama runtime.start con el estado de layout anterior al primer await. No hay una selección explícita de activeLeaf, apertura de ventana o carga de workspace en ese camino observado. Esto acota el análisis; no atribuye el cambio externo o nativo del host.

## Prepared Follow-Up

Una unidad funcional distinta puede partir de la 0.1.6 ya cargada sin volver a copiar, descargar o cargar inicialmente Manager. Mantiene todos los guards y añade firstGuardFailure con miembro, fase y snapshots de hashes al primer cambio observado. Su aceptación requiere review focal, baseline actual y nuevo grant ROOT. La instalación observada aquí no acredita todavía funcionamiento de los toggles ni aceptación visual.
