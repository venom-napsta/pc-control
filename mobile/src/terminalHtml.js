// The terminal page has no password and no WebSocket address baked into it.
// After the WebView loads, TerminalScreen injects startTerminalScript({ wsUrl,
// pin }), and the page sends the PIN as the first WebSocket frame. The PIN
// therefore never appears in a URL (uvicorn logs every WebSocket URL to the
// journal) or inside an HTML script tag.
//
// xterm.js and its fit addon are served by the PC itself (server.py mounts
// /static), so the terminal works on a LAN or Tailscale-only network with no
// internet, and the phone never talks to a CDN.

export function toWsUrl(serverUrl) {
  return String(serverUrl || "")
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://")
    .replace(/\/+$/, "");
}

// "http://pc:2000", "xterm.js" -> "http://pc:2000/static/xterm.js"
export function terminalAssetUrl(serverUrl, file) {
  return `${String(serverUrl || "").replace(/\/+$/, "")}/static/${file}`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// JS to run inside the WebView once it has loaded. JSON.stringify is safe in a
// JS context (this is not embedded in HTML).
export function startTerminalScript({ wsUrl, pin }) {
  // "<" is escaped so the payload stays inert even if it ever ends up inside
  // an HTML script tag; U+2028/2029 for older JS engines.
  const json = JSON.stringify({ wsUrl, pin })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.startTerminal(${json}); true;`;
}

export function getTerminalHTML(serverUrl) {
  const asset = (file) => escapeAttr(terminalAssetUrl(serverUrl, file));
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="${asset("xterm.css")}">
  <script src="${asset("xterm.js")}"></script>
  <script src="${asset("addon-fit.js")}"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;background:#0B1420;overflow:hidden}
    #terminal{height:100%}
    .xterm{height:100%;padding:4px}
    .xterm-viewport::-webkit-scrollbar{width:6px}
    .xterm-viewport::-webkit-scrollbar-thumb{background:#094A52;border-radius:3px}
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    function post(msg){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg); }

    var ws = null, term = null, fitAddon = null, ctrlOn = false;
    window.setCtrl = function(on){ ctrlOn = on; };
    window.setFontSize = function(px){
      if(!term) return;
      var next = Math.max(8, Math.min(28, px));
      term.options.fontSize = next;
      if(fitAddon){ fitAddon.fit(); sendResize(); }
      post('font:' + next);
    };
    window.nudgeFontSize = function(delta){
      if(term) window.setFontSize((term.options.fontSize || 13) + delta);
    };
    window.sendTermKey = function(data){
      if(ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    };

    function sendResize(){
      if(!fitAddon || !ws || ws.readyState !== WebSocket.OPEN) return;
      var dims = fitAddon.proposeDimensions();
      if(dims) ws.send(new TextEncoder().encode('\\x01RESIZE:'+dims.rows+','+dims.cols));
    }

    window.startTerminal = function(cfg){
      if(typeof Terminal === 'undefined' || typeof FitAddon === 'undefined'){
        post('assets_failed'); // xterm did not load from the PC's /static mount
        return;
      }
      if(ws) return;

      term = new Terminal({
        theme:{
          background:'#0B1420',foreground:'#e0e0e0',cursor:'#00D9C4',
          cursorAccent:'#0B1420',selectionBackground:'#094A52',
          black:'#000000',red:'#EF5350',green:'#4CAF50',yellow:'#FF9800',
          blue:'#5C7CF5',magenta:'#9C27B0',cyan:'#00D9C4',white:'#FFFFFF',
          brightBlack:'#546E7A',brightRed:'#FF8A80',brightGreen:'#69F0AE',
          brightYellow:'#FFD740',brightBlue:'#448AFF',brightMagenta:'#EA80FC',
          brightCyan:'#84FFFF',brightWhite:'#FFFFFF',
        },
        fontSize:13,fontFamily:'monospace',cursorBlink:true,cursorStyle:'bar',
        scrollback:5000,allowTransparency:true,
      });
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));
      fitAddon.fit();

      ws = new WebSocket(cfg.wsUrl + '/ws/terminal');
      ws.binaryType = 'arraybuffer';

      ws.onopen = function(){
        ws.send(JSON.stringify({ pin: cfg.pin }));   // auth frame, never a URL
        term.write('\\r\\n\\x1b[1;36m Connected to PC terminal \\x1b[0m\\r\\n\\r\\n');
        setTimeout(function(){ fitAddon.fit(); sendResize(); }, 100);
        post('connected');
      };
      ws.onmessage = function(e){
        term.write(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data);
      };
      ws.onclose = function(e){
        if(e.code === 4001){
          term.write('\\r\\n\\x1b[1;31m Rejected: wrong password or locked out \\x1b[0m\\r\\n');
          post('auth_failed');
        } else {
          term.write('\\r\\n\\x1b[1;31m Disconnected \\x1b[0m\\r\\n');
          post('disconnected');
        }
      };
      ws.onerror = function(){
        term.write('\\r\\n\\x1b[1;31m Connection error \\x1b[0m\\r\\n');
        post('error');
      };

      term.onData(function(data){
        if(ws.readyState !== WebSocket.OPEN) return;
        if(ctrlOn && data.length === 1){
          var code = data.toUpperCase().charCodeAt(0);
          if(code >= 65 && code <= 90) data = String.fromCharCode(code - 64);
          ctrlOn = false;
          post('ctrl_off');
        }
        ws.send(data);
      });

      window.addEventListener('resize', function(){ fitAddon.fit(); sendResize(); });
      new ResizeObserver(function(){ fitAddon.fit(); sendResize(); })
        .observe(document.getElementById('terminal'));
    };
  </script>
</body>
</html>`;
}
