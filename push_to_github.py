"""Push workspace files to GitHub via API (no git CLI needed)"""
import os, base64, json, urllib.request, urllib.error

TOKEN   = os.environ['GH_PAT']
USER    = os.environ.get('GH_USER', 'thisiscount01')
REPO    = 'organt-p-024'
BRANCH  = 'main'
BASE    = f'https://api.github.com/repos/{USER}/{REPO}'

HEADERS = {
    'Authorization': f'token {TOKEN}',
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
}

def api(method, path, body=None):
    url  = BASE + path
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def push_file(repo_path, local_path):
    with open(local_path, 'rb') as f:
        content = base64.b64encode(f.read()).decode()
    # Check if file exists (to get SHA for update)
    existing = api('GET', f'/contents/{repo_path}')
    sha = existing.get('sha')
    body = {
        'message': f'add {repo_path}',
        'content': content,
        'branch': BRANCH,
    }
    if sha:
        body['sha'] = sha
    result = api('PUT', f'/contents/{repo_path}', body)
    if 'content' in result:
        print(f'  OK  {repo_path}')
    else:
        print(f'  ERR {repo_path}: {result.get("message","?")}')

# Initialize repo with README first (to create main branch)
result = api('PUT', '/contents/README.md', {
    'message': 'init',
    'content': base64.b64encode(b'# Organt Chat\n\nAI-powered real-time chat. Built by Organt.\n').decode(),
    'branch': BRANCH,
})
print('init:', result.get('content', {}).get('name', result.get('message', '?')))

# Files to push (repo_path: local_path)
files = {
    'package.json':              'package.json',
    'server.js':                 'server.js',
    'public/style.css':          'public/style.css',
    'public/index.html':         'public/index.html',
    'public/app.js':             'public/app.js',
    'public/marked.min.js':      'public/marked.min.js',
    'public/purify.min.js':      'public/purify.min.js',
    'public/highlight.min.js':   'public/highlight.min.js',
    'public/highlight-dark.min.css': 'public/highlight-dark.min.css',
}

for repo_path, local_path in files.items():
    if os.path.exists(local_path):
        push_file(repo_path, local_path)
    else:
        print(f'  SKIP {local_path} (not found)')

print('Done.')
