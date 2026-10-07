# Commander Remaining Two Plan

2026-10-07, Codex. Nueva unidad autorizada explícitamente por ROOT después del cierre de token63abeb26. El primer fallo y sus efectos se conservan. Commander está cargado en el Sandbox original; sólo faltan los runtimes de Sandbox 2 y Sandbox 3.

## Scope

Targets exclusivos: Sandbox 2 y Sandbox 3. El inner y outer rechazan incluir el original antes de cualquier write. El anchor del nuevo controller es Sandbox 2, appId ea43ae4a186d86d2, window12/webContents14 en la lectura actual. Se utiliza CLI vault=Sandbox 2 y Poll del mismo job/token. No carga, descarga, copia ni configura el original o ENSO.

Sólo main.js, manifest.json y styles.css del candidato Commander 0.5.13, mismos bytes de la primera unidad. Datos propios y 94 archivos de configuración se conservan raw; configs/workspaces de ambos targets tienen backup privado durable antes del primer lifecycle. El nuevo scope no restaura estado previo de otros plugins ni el original.

## Exact Layout Exception

La carga de Commander añade sus botones al registro left-ribbon.hiddenItems. El original ya cargado muestra estas tres entradas con valor false; la lectura filesystem de 2/3 las encontró ausentes:

- cmdr:Open settings
- cmdr:Web viewer: Search the web
- cmdr:Web viewer: Open web viewer

Se admite sólo esas tres keys con false en el layout y workspace.json de los targets. El resto de la estructura JSON, activeLeaf, buffers, Settings/popups, core/plugins ajenos, native flags/order y ventanas/foco siguen estrictos. Cualquier otra key Cmdr, key ajena o valor true provoca fallo. Workspace raw se compara antes del lifecycle y, después, su estructura sólo puede variar por esta lista exacta. No se sobrescribe el archivo para forzar aceptación: la escritura esperada procede del host durante carga de Commander, y los receipts registran su hash observado.

## Checks and Review

Dieciocho checks simulados PASS: quince inner (nueve previos más original rechazado, own ribbon aceptado, foreign ribbon rechazado, otro Cmdr key rechazado, valor true rechazado y leaf distinto rechazado), dos ACK inválidos del dispatcher real y el outer sin vm disponible en renderer. No suite de producto ni build nuevo.

Paquete leído el 2026-10-07T12:54:49.341Z: cmdr3-ready-KxCFgu, loadedSHA1c6149c09a896b059999f76d0f205a993b727fc1770a8882bab60ae536df63fb. Helper416d4bf3, dispatcherf1e6901c, checker74361171. Candidato main.js d33ccd350ae2b642c65fed2a562808640bbef060b1705e7b110ea1b43ba942d2, manifest36c2b6e17b2dd3f06930d0b11700581393c60a855b7ee031e0989f46ab2b26ec, stylesfa41476fda982d376ee358c54978d9b072fd462d2cecc82305912126f7a260a9.

- [x] First unit terminal, ROOT closure/RELEASE y preservación de efectos.
- [x] Scope nuevo 2/3 exclusivamente y anchor independiente del original.
- [x] Excepción de layout exacta, con faults causales y 18 checks.
- [x] Lectura/compilación de paquete privado nuevas, sin instalación.
- [ ] Peer del nuevo delta: solicitado con source congelado; pendiente.
- [ ] Grant/Begin/readback/cierre ROOT: no ejecutados.

El paquete no se actualiza mientras espera review/grant. ROOT verifica sus pins, baseline y estado actual antes de emitir el grant. Si esa baseline cambió, se conserva y reconcilia primero; no se reejecuta un job ni se restaura un backup para forzar coincidencia.
