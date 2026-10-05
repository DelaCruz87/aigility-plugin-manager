"""Private start-once delivery adapter; reuses the published lease/job pattern.

prepare is offline. begin needs a fresh absolute supervisor START. A CLI
timeout never cancels JS; use poll on the SAME control, never another begin.
"""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time

project=Path(__file__).resolve().parent.parent
action=sys.argv[1]
source=(project/'checks/enso-delivery-v013.mjs').read_text()
source=source.replace('export function delivery(', 'function delivery(', 1)
digest=lambda b:hashlib.sha256(b).hexdigest()
epoch=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
def durable(path, data):
    with path.open('x') as out:
        out.write(json.dumps(data,indent=2)+'\n');out.flush();os.fsync(out.fileno())
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

if action=='prepare':
    proc=subprocess.run(['node','--check',str(project/'checks/enso-delivery-v013.mjs')],capture_output=True,text=True)
    if proc.returncode:raise RuntimeError(proc.stderr)
    print(json.dumps({'sourceSha':digest(source.encode()),'moduleSha':digest((project/'checks/enso-delivery-v013.mjs').read_bytes()),'adapterSha':digest(Path(__file__).read_bytes()),'offlineSyntax':True,'nativeCalls':0}))
    sys.exit(0)

control=Path(sys.argv[2]).resolve()
if action=='begin':
    ack,start_by,grant=sys.argv[3:6];start=epoch(ack);now=int(time.time()*1000)
    assert start<=now<min(epoch(start_by),start+150000),'NO_START: expired/future lease'
    assert not control.exists(),'Existing intent; poll SAME, never repeat begin'
    root=Path('/Users/eme/Obsidian/ENSO');st=root.stat()
    request={'action':'deploy','token':grant,'vault':'ENSO','window':10,'wc':10,'appId':'770c2d6b37fb662f','root':str(root),'dev':st.st_dev,'ino':st.st_ino,'source':str(project),'backup':str(project/'evidence/release-backups'/grant),'ack':ack,'startBy':start_by,'deadline':start+180000,'actionDeadline':start+150000,'moduleSha':digest((project/'checks/enso-delivery-v013.mjs').read_bytes()),'artifacts':{n:digest((project/n).read_bytes()) for n in ['main.js','manifest.json','styles.css']}}
    paths=[root/'.obsidian'/n for n in ['community-plugins.json','core-plugins.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json']]
    request['preimages']={str(p):digest(p.read_bytes()) for p in paths}
    durable(control,{'status':'dispatch-prepared','pending':True,'request':request})
    inner='(()=>{'+source+';return delivery('+json.dumps(request)+');})()'
elif action=='poll':
    request=json.loads(control.read_text())['request']
    inner="(()=>{const q=window.__ensoManagerDelivery?.get("+json.dumps(request['token'])+");if(!q)return {status:'missing',pending:null};return q.receipt??{token:q.token,status:q.status,phase:q.phase,pending:q.pending,error:q.error??null};})()"
else:raise ValueError('Only prepare/begin/poll')

# Same URL may represent multiple windows. Route through the guarded Sandbox
# primary, then bind the exact ENSO window/webContents and validate its realm.
route="(async()=>{if(app.vault.getName()!=='Sandbox'||app.appId!=='d137282e82167d84'||require('@electron/remote').getCurrentWindow().id!==9||app.workspace.containerEl.ownerDocument!==document)throw Error('Wrong dispatch realm');const ws=require('@electron/remote').BrowserWindow.getAllWindows().filter(w=>w.id===10&&w.webContents.id===10&&!w.webContents.isCrashed());if(ws.length!==1)throw Error('ENSO window not unique');const w=ws[0];const out=await w.webContents.executeJavaScript("+json.dumps(inner)+");if(w.id!==10||w.webContents.id!==10||w.isDestroyed()||w.webContents.isCrashed())throw Error('ENSO realm changed after await');return out;})()"
try:
    proc=subprocess.run(['/opt/homebrew/bin/obsidian','vault=Sandbox','eval','code='+route],capture_output=True,text=True,timeout=15)
    if proc.returncode:raise RuntimeError(proc.stderr or proc.stdout)
    raw=proc.stdout.strip().split('=> ',1)[-1]
    result=json.loads(raw)
    print(json.dumps(result,indent=2))
    if result.get('pending') is False:
        terminal=control.with_name(control.stem+'.result.json')
        if not terminal.exists():durable(terminal,result)
except Exception as error:
    print(json.dumps({'status':'unknown','pending':True,'control':str(control),'error':str(error),'next':'poll SAME control; no new begin or rollback'}))
    sys.exit(2)
