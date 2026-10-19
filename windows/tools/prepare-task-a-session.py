# SPDX-License-Identifier: AGPL-3.0-only
import json, pathlib, urllib.request, urllib.error, sys
root = pathlib.Path(__file__).resolve().parents[1]
config = json.loads((root/'Zappion.Windows/appsettings.local.json').read_text(encoding='utf-8-sig'))
base = config['SupabaseUrl'].rstrip('/')
if not base.startswith(('http://localhost:', 'http://127.0.0.1:')): raise RuntimeError('Local Supabase only')
directory = root/'.verification/task-a-live'
directory.mkdir(parents=True, exist_ok=True)
if '--logout' in sys.argv:
 session_path = directory/'session.json'
 if session_path.exists():
  session = json.loads(session_path.read_text(encoding='utf-8'))
  logout = urllib.request.Request(base+'/auth/v1/logout?scope=local', data=b'', headers={'apikey':config['SupabaseKey'], 'Authorization':'Bearer '+session['access_token']}, method='POST')
  try:
   with urllib.request.urlopen(logout): pass
  except urllib.error.HTTPError as error:
   if error.code not in (401,403): raise RuntimeError(f'Isolated logout failed: {error.code}') from None
  session_path.unlink()
 print('Signed out only the isolated verification session (scope local).')
 sys.exit(0)
headers = {'apikey':config['SupabaseKey'], 'Content-Type':'application/json'}
request = urllib.request.Request(base+'/auth/v1/token?grant_type=password',data=json.dumps({'email':'goat@craft.com','password':'goat'}).encode(),headers=headers)
try:
 with urllib.request.urlopen(request) as response: session=json.load(response)
except urllib.error.HTTPError as error: raise RuntimeError(f'Seed sign-in failed: {error.code}') from None
(directory/'session.json').write_text(json.dumps(session), encoding='utf-8')
(directory/'preferences.json').write_text(json.dumps({'Theme':'dark','Language':'en','DesktopNotifications':False,'NotificationSound':False}), encoding='utf-8')
print('Created isolated seed-account session under windows/.verification/task-a-live; credentials and tokens suppressed.')
