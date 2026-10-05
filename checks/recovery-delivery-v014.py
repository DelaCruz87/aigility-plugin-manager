"""Private start-once delivery adapter; reuses the published lease/job pattern.

prepare is offline. begin needs a fresh absolute supervisor START. A CLI
timeout never cancels JS; use poll on the SAME control, never another begin.
"""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time

project=Path(__file__).resolve().parent.parent
action=sys.argv[1]
source=(project/'checks/recovery-delivery-v014.mjs').read_text()
source=source.replace('export async function ', 'async function ').replace('export function ', 'function ')
digest=lambda b:hashlib.sha256(b).hexdigest()
epoch=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
def durable(path, data):
    with path.open('x') as out:
        out.write(json.dumps(data,indent=2)+'\n');out.flush();os.fsync(out.fileno())
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

if action=='prepare':
    proc=subprocess.run(['node','--check',str(project/'checks/recovery-delivery-v014.mjs')],capture_output=True,text=True)
    if proc.returncode:raise RuntimeError(proc.stderr)
    print(json.dumps({'sourceSha':digest(source.encode()),'moduleSha':digest((project/'checks/recovery-delivery-v014.mjs').read_bytes()),'adapterSha':digest(Path(__file__).read_bytes()),'offlineSyntax':True,'nativeCalls':0}))
    sys.exit(0)

FROZEN_ARTIFACTS={'main.js': '8eb589aad0a6bb6a93a1a2faccfbbc3e8070dda855c9856ffcb63e6856239752', 'manifest.json': 'df8e023530cbb03431c4bab343b24bb3aae0b601b518e634c2c07d6b1e7c7a91', 'styles.css': '9a21d84a6c179986d64b8c0c97406ee4332ce6a605ab87766c7ed1dd6ac8e10e'}
FROZEN_MODULE='e52b5cdae7e56b93c483901f6c3f145743bb08da1c21d3d9956b0f7e1ae8bd79'
control=Path(sys.argv[2]).resolve()
if action=='begin':
    assert digest((project/'checks/recovery-delivery-v014.mjs').read_bytes())==FROZEN_MODULE,'NO_START: reviewed module drift'
    assert {n:digest((project/n).read_bytes()) for n in FROZEN_ARTIFACTS}==FROZEN_ARTIFACTS,'NO_START: frozen artifact drift'
    ack,start_by,grant=sys.argv[3:6];start=epoch(ack);now=int(time.time()*1000)
    assert start<=now<min(epoch(start_by),start+90000),'NO_START: expired/future lease'
    assert not control.exists(),'Existing intent; poll SAME, never repeat begin'
    root=Path('/Users/eme/Obsidian/Sandbox');st=root.stat()
    request={'action':'update','controlPath':str(control),'token':grant,'vault':'Sandbox','window':9,'wc':9,'appId':'d137282e82167d84','root':str(root),'dev':st.st_dev,'ino':st.st_ino,'source':str(project),'backup':str(project/'evidence/release-backups'/grant),'ack':ack,'startBy':start_by,'deadline':start+180000,'actionDeadline':start+120000,'moduleSha':digest((project/'checks/recovery-delivery-v014.mjs').read_bytes()),'artifacts':{n:digest((project/n).read_bytes()) for n in ['main.js','manifest.json','styles.css']}}
    paths=[root/'.obsidian'/n for n in ['community-plugins.json','core-plugins.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','plugins/aigility-plugin-manager/main.js','plugins/aigility-plugin-manager/manifest.json','plugins/aigility-plugin-manager/styles.css']]
    request['preimages']={str(p):digest(p.read_bytes()) for p in paths}
    statePath=root/'.obsidian/plugins/aigility-plugin-manager/data.json'
    request['stateSha']=digest(statePath.read_bytes())
    durable(control,{'status':'dispatch-prepared','pending':True,'request':request})
    dispatched={**request,'controlSha':digest(control.read_bytes())}
    inner='(()=>{'+source+';return recoveryDelivery('+json.dumps(dispatched)+');})()'
elif action=='poll':
    request=json.loads(control.read_text())['request']
    inner="(()=>{const q=window.__managerRecoveryDelivery?.get("+json.dumps(request['token'])+");if(!q)return {status:'missing',pending:null};return q.receipt??{token:q.token,status:q.status,phase:q.phase,pending:q.pending,error:q.error??null};})()"
else:raise ValueError('Only prepare/begin/poll')

# Direct Sandbox dispatch; native source binds exact primary9/document/root.
route=inner
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
