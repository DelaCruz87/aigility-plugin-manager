"""One bounded native UI delta; begin once, poll the SAME token until settled."""
from pathlib import Path
import datetime,hashlib,json,os,subprocess,sys,time
project=Path(__file__).resolve().parent.parent
action=sys.argv[1]
module=project/'checks/manager-ui-delta-v013.mjs'
source=module.read_text().replace('export function uiDelta(', 'function uiDelta(', 1)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
epoch=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
def durable(path,value):
 with path.open('x') as f:f.write(json.dumps(value,indent=2)+'\n');f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
if action=='prepare':
 p=subprocess.run(['node','--check',str(module)],capture_output=True,text=True)
 if p.returncode:raise RuntimeError(p.stderr)
 print(json.dumps({'moduleSha':sha(module),'adapterSha':sha(Path(__file__)),'syntax':True,'nativeCalls':0}));sys.exit(0)
control=Path(sys.argv[2]).resolve()
if action=='begin':
 vault,ack,start_by,token=sys.argv[3:7];start=epoch(ack);now=int(time.time()*1000)
 assert vault in ['Sandbox','ENSO'] and start<=now<min(epoch(start_by),start+90000),'NO_START'
 r={'vault':vault,'token':token,'window':9 if vault=='Sandbox' else 10,'wc':9 if vault=='Sandbox' else 10,'appId':'d137282e82167d84' if vault=='Sandbox' else '770c2d6b37fb662f','root':'/Users/eme/Obsidian/'+vault,'deadline':start+120000,'actionDeadline':start+90000,'ack':ack,'startBy':start_by,'output':str(project/'evidence/native-ui-v013'/token),'moduleSha':sha(module)}
 durable(control,{'status':'dispatch-prepared','pending':True,'request':r})
 inner='(()=>{'+source+';return uiDelta('+json.dumps(r)+');})()'
elif action=='poll':
 r=json.loads(control.read_text())['request'];inner="(()=>{const q=window.__managerUIDelta?.get("+json.dumps(r['token'])+");return q?.receipt??{status:q?.status??'missing',pending:q?.pending??null,phase:q?.phase,error:q?.error??null};})()"
else:raise ValueError('prepare/begin/poll only')
route="(async()=>{if(app.vault.getName()!=='Sandbox'||require('@electron/remote').getCurrentWindow().id!==9||app.workspace.containerEl.ownerDocument!==document)throw Error('Dispatch primary guard');const ws=require('@electron/remote').BrowserWindow.getAllWindows().filter(w=>w.id==="+str(r['window'])+"&&w.webContents.id==="+str(r['wc'])+"&&!w.webContents.isCrashed());if(ws.length!==1)throw Error('Exact UI window missing');return await ws[0].webContents.executeJavaScript("+json.dumps(inner)+");})()"
try:
 p=subprocess.run(['/opt/homebrew/bin/obsidian','vault=Sandbox','eval','code='+route],capture_output=True,text=True,timeout=15)
 if p.returncode:raise RuntimeError(p.stderr or p.stdout)
 value=json.loads(p.stdout.strip().split('=> ',1)[-1]);print(json.dumps(value,indent=2))
 if value.get('pending') is False:
  result=control.with_name(control.stem+'.result.json')
  if not result.exists():durable(result,value)
except Exception as e:
 print(json.dumps({'status':'unknown','pending':True,'error':str(e),'next':'poll SAME control; no new begin'}));sys.exit(2)
