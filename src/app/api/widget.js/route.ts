import { NextResponse } from "next/server";
import { withApiLogging } from "@/modules/observability/api";

async function GETHandler(request: Request) {
  const url = new URL(request.url);
  const script = `(function(){
  var currentScript = document.currentScript;
  if (!currentScript) return;

  var workspace = currentScript.getAttribute('data-workspace');
  if (!workspace) {
    console.error('CCP widget: missing data-workspace attribute.');
    return;
  }

  var base = currentScript.src.split('/api/widget.js')[0];
  var iframe = document.createElement('iframe');
  var button = document.createElement('button');
  var open = false;

  iframe.src = base + '/widget/embed?workspace=' + encodeURIComponent(workspace);
  iframe.style.position = 'fixed';
  iframe.style.bottom = '90px';
  iframe.style.right = '20px';
  iframe.style.width = '360px';
  iframe.style.height = '560px';
  iframe.style.border = '1px solid rgba(0,0,0,0.15)';
  iframe.style.borderRadius = '16px';
  iframe.style.boxShadow = '0 20px 60px rgba(0,0,0,0.2)';
  iframe.style.background = '#fff';
  iframe.style.zIndex = '2147483000';
  iframe.style.display = 'none';

  button.type = 'button';
  button.textContent = 'Chat';
  button.setAttribute('aria-label', 'Open chat');
  button.style.position = 'fixed';
  button.style.bottom = '20px';
  button.style.right = '20px';
  button.style.width = '56px';
  button.style.height = '56px';
  button.style.border = '0';
  button.style.borderRadius = '999px';
  button.style.background = '#b65a34';
  button.style.color = '#fff';
  button.style.font = '600 14px system-ui, sans-serif';
  button.style.cursor = 'pointer';
  button.style.zIndex = '2147483001';
  button.style.boxShadow = '0 10px 24px rgba(182,90,52,0.45)';

  function syncUI(){
    iframe.style.display = open ? 'block' : 'none';
    button.textContent = open ? 'Close' : 'Chat';
  }

  button.addEventListener('click', function(){
    open = !open;
    syncUI();
  });

  window.addEventListener('message', function(event){
    if (event.data === 'relaydesk:close') {
      open = false;
      syncUI();
    }
  });

  document.body.appendChild(iframe);
  document.body.appendChild(button);
})();`;

  return new NextResponse(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-relaydesk-origin": url.origin,
    },
  });
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/widget.js");
