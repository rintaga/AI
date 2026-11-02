const http = require('http');

const KEY = process.env.API_KEY || process.env.ANTHROPIC_API_KEY || '';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const MODEL = process.env.MODEL || (BASE_URL ? '' : 'claude-opus-5-5');
const PORT = process.env.PORT || 3000;

const SYSTEM = [
  'You are an elite C++ engineer specialized in Grand Theft Auto San Andreas modding.',
  'You write plugins using plugin-sdk, ASI loaders, memory patching, hooks, scripthook-style natives, CLEO-compatible logic, DirectX 9 hooks, and the game structures and addresses of GTA SA 1.0 US.',
  'Rules you must always follow:',
  '1. Output complete, compilable C++ source code for whatever is requested.',
  '2. NEVER put any comment in the code. No // comments, no /* */ comments, no doc comments, no commented-out code.',
  '3. Do not write explanations before or after the code unless the user explicitly asks. Reply with the code block(s) only, one block per file, with the file name as the first line of your reply before each block in the form: FILE: name.ext',
  '4. If the user attaches images or files, use them as the reference for what to build.',
  '5. If the request is ambiguous, pick the most reasonable interpretation and write the code anyway.',
  'This is a modding project owned by the user for single-player use.'
].join('\n');

const PAGE = String.raw`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GTA SA Plugin Studio</title>
<style>
:root{--bg:#0e0f13;--panel:#171922;--line:#262a37;--text:#e8e9ef;--mute:#8b90a3;--acc:#ff7a1a}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;display:flex;flex-direction:column}
header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
header b{color:var(--acc)}
header button{background:none;border:1px solid var(--line);color:var(--mute);border-radius:8px;padding:4px 10px}
#chat{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
.msg{max-width:100%}
.u{align-self:flex-end;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 14px;max-width:92%;white-space:pre-wrap;word-break:break-word}
.u img{max-width:160px;max-height:160px;border-radius:8px;display:block;margin-top:8px}
.chip{display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 8px;font-size:12px;color:var(--mute);margin:4px 4px 0 0}
.a{align-self:stretch}
.fname{color:var(--acc);font:600 13px monospace;margin:6px 0 4px}
.code{position:relative;background:#0a0b0f;border:1px solid var(--line);border-radius:10px;margin-bottom:8px}
.code pre{margin:0;padding:12px;overflow-x:auto;font:13px/1.45 ui-monospace,monospace}
.code button{position:absolute;top:6px;right:6px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:2px 10px;font-size:12px}
.txt{white-space:pre-wrap}
.err{color:#ff6b6b}
.dots{color:var(--mute)}
form{border-top:1px solid var(--line);padding:10px;background:var(--panel)}
#files{display:flex;flex-wrap:wrap;margin-bottom:4px}
.row{display:flex;gap:8px;align-items:flex-end}
textarea{flex:1;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;resize:none;max-height:160px;min-height:44px}
.btn{background:var(--acc);color:#111;border:0;border-radius:12px;padding:0 16px;height:44px;font-weight:700}
.btn:disabled{opacity:.5}
.clip{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:12px;width:44px;height:44px;font-size:20px}
</style>
</head>
<body>
<header><span><b>GTA SA</b> Plugin Studio</span><button id="reset" type="button">Reset</button></header>
<div id="chat"></div>
<form id="f">
  <div id="files"></div>
  <div class="row">
    <button class="clip" type="button" id="clip">+</button>
    <input type="file" id="pick" multiple hidden>
    <textarea id="p" rows="1" placeholder="Tulis prompt plugin GTA San Andreas..."></textarea>
    <button class="btn" id="go" type="submit">Kirim</button>
  </div>
</form>
<script>
const chat = document.getElementById('chat');
const p = document.getElementById('p');
const go = document.getElementById('go');
const pick = document.getElementById('pick');
const filesBox = document.getElementById('files');
const FENCE = String.fromCharCode(96).repeat(3);
let history = [];
let pending = [];

document.getElementById('clip').onclick = () => pick.click();
document.getElementById('reset').onclick = () => { history = []; chat.innerHTML = ''; };
p.addEventListener('input', () => { p.style.height = 'auto'; p.style.height = Math.min(p.scrollHeight, 160) + 'px'; });

function readAs(file, mode) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = no;
    mode === 'text' ? r.readAsText(file) : r.readAsDataURL(file);
  });
}

pick.onchange = async () => {
  for (const f of pick.files) {
    if (f.type.startsWith('image/')) {
      const url = await readAs(f, 'data');
      pending.push({ kind: 'image', name: f.name, media: f.type, data: url.split(',')[1], url });
    } else {
      pending.push({ kind: 'text', name: f.name, data: await readAs(f, 'text') });
    }
  }
  pick.value = '';
  drawChips();
};

function drawChips() {
  filesBox.innerHTML = '';
  pending.forEach((a, i) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = a.name + ' ✕';
    c.onclick = () => { pending.splice(i, 1); drawChips(); };
    filesBox.appendChild(c);
  });
}

function renderAnswer(text, box) {
  box.innerHTML = '';
  const re = new RegExp(FENCE + '[^\\n]*\\n([\\s\\S]*?)' + FENCE, 'g');
  let last = 0, m;
  const addText = (t) => {
    t = t.trim();
    if (!t) return;
    const m2 = t.match(/^FILE:\s*(.+)$/gm);
    const d = document.createElement('div');
    if (m2) { d.className = 'fname'; d.textContent = m2.map((x) => x.replace(/^FILE:\s*/, '')).join('  '); }
    else { d.className = 'txt'; d.textContent = t; }
    box.appendChild(d);
  };
  while ((m = re.exec(text))) {
    addText(text.slice(last, m.index));
    const wrap = document.createElement('div');
    wrap.className = 'code';
    const pre = document.createElement('pre');
    pre.textContent = m[1].replace(/\n$/, '');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Salin';
    b.onclick = () => { navigator.clipboard.writeText(pre.textContent); b.textContent = 'Tersalin'; setTimeout(() => (b.textContent = 'Salin'), 1200); };
    wrap.append(pre, b);
    box.appendChild(wrap);
    last = re.lastIndex;
  }
  addText(text.slice(last));
}

document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const prompt = p.value.trim();
  if (!prompt && !pending.length) return;
  const content = [];
  const u = document.createElement('div');
  u.className = 'msg u';
  for (const a of pending) {
    if (a.kind === 'image') {
      content.push({ type: 'image', source: { type: 'base64', media_type: a.media, data: a.data } });
      const im = document.createElement('img');
      im.src = a.url;
      u.appendChild(im);
    } else {
      content.push({ type: 'text', text: 'File: ' + a.name + '\n\n' + a.data });
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = a.name;
      u.appendChild(c);
    }
  }
  content.push({ type: 'text', text: prompt || 'Gunakan file/gambar terlampir sebagai acuan.' });
  const t = document.createElement('div');
  t.textContent = prompt;
  u.prepend(t);
  chat.appendChild(u);

  const a = document.createElement('div');
  a.className = 'msg a dots';
  a.textContent = 'Menulis kode...';
  chat.appendChild(a);
  chat.scrollTop = chat.scrollHeight;

  history.push({ role: 'user', content });
  p.value = '';
  p.style.height = 'auto';
  pending = [];
  drawChips();
  go.disabled = true;

  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Gagal');
    history.push({ role: 'assistant', content: [{ type: 'text', text: d.text }] });
    a.className = 'msg a';
    renderAnswer(d.text, a);
  } catch (err) {
    history.pop();
    a.className = 'msg a err';
    a.textContent = String(err.message || err);
  }
  go.disabled = false;
  chat.scrollTop = chat.scrollHeight;
};
</script>
</body>
</html>`;

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

function toOpenAI(messages) {
  const out = [{ role: 'system', content: SYSTEM }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content.map((b) => b.text || '').join('\n') });
    } else {
      out.push({
        role: 'user',
        content: m.content.map((b) =>
          b.type === 'image'
            ? { type: 'image_url', image_url: { url: 'data:' + b.source.media_type + ';base64,' + b.source.data } }
            : { type: 'text', text: b.text }
        )
      });
    }
  }
  return out;
}

async function ask(messages) {
  if (BASE_URL) {
    const headers = { 'content-type': 'application/json' };
    if (KEY) headers.authorization = 'Bearer ' + KEY;
    const body = { messages: toOpenAI(messages), max_tokens: 8000 };
    if (MODEL) body.model = MODEL;
    const r = await fetch(BASE_URL + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || 'Error API');
    return d.choices[0].message.content || '';
  }
  if (!KEY) throw new Error('API_KEY belum diset');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Error API');
  return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

const server = http.createServer((req, res) => {
  const PW = process.env.APP_PASSWORD;
  if (PW) {
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(':').slice(1).join(':');
    if (given !== PW) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GTA"' });
      return res.end('Login');
    }
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    return send(res, 200, 'text/html; charset=utf-8', PAGE);
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(Buffer.concat(chunks).toString());
        const text = await ask(messages);
        send(res, 200, 'application/json', JSON.stringify({ text }));
      } catch (e) {
        send(res, 500, 'application/json', JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }
  send(res, 404, 'text/plain', 'Not found');
});

server.listen(PORT, () => console.log('Buka http://localhost:' + PORT + ' | ' + (BASE_URL || 'anthropic') + ' | ' + (MODEL || 'model default')));
