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
  var nudge = document.createElement('button');
  var style = document.createElement('style');
  var open = false;

  iframe.src = base + '/widget/embed?workspace=' + encodeURIComponent(workspace);
  iframe.title = 'Cosmofeed support chat';
  iframe.style.position = 'fixed';
  iframe.style.bottom = '88px';
  iframe.style.right = '16px';
  iframe.style.width = 'min(392px, calc(100vw - 24px))';
  iframe.style.height = 'min(640px, calc(100vh - 108px))';
  iframe.style.border = '1px solid rgba(17,19,27,0.14)';
  iframe.style.borderRadius = '12px';
  iframe.style.boxShadow = '0 28px 80px rgba(17,19,27,0.28), 0 4px 16px rgba(17,19,27,0.12)';
  iframe.style.background = '#fff';
  iframe.style.zIndex = '2147483000';
  iframe.style.display = 'none';

  button.type = 'button';
  button.setAttribute('aria-label', 'Open chat');
  button.setAttribute('title', 'Open support chat');
  button.style.position = 'fixed';
  button.style.bottom = '18px';
  button.style.right = '16px';
  button.style.width = '58px';
  button.style.height = '58px';
  button.style.border = '2px solid rgba(255,255,255,0.8)';
  button.style.borderRadius = '50%';
  button.style.background = '#171923';
  button.style.color = '#fff';
  button.style.cursor = 'pointer';
  button.style.zIndex = '2147483001';
  button.style.boxShadow = '0 14px 34px rgba(17,19,27,0.28)';
  button.style.display = 'grid';
  button.style.placeItems = 'center';
  button.style.transition = 'transform 180ms ease, box-shadow 180ms ease, background 180ms ease';

  nudge.type = 'button';
  nudge.textContent = 'Questions? We are here';
  nudge.setAttribute('aria-label', 'Open support chat');
  nudge.style.position = 'fixed';
  nudge.style.bottom = '27px';
  nudge.style.right = '84px';
  nudge.style.zIndex = '2147483001';
  nudge.style.border = '1px solid rgba(17,19,27,0.1)';
  nudge.style.borderRadius = '8px';
  nudge.style.background = '#fff';
  nudge.style.color = '#202330';
  nudge.style.padding = '10px 13px';
  nudge.style.boxShadow = '0 10px 30px rgba(17,19,27,0.15)';
  nudge.style.font = '700 12px system-ui, sans-serif';
  nudge.style.cursor = 'pointer';
  nudge.style.animation = 'relaydesk-nudge 420ms cubic-bezier(.2,.8,.2,1) both 900ms';

  style.textContent = '@keyframes relaydesk-nudge{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}@keyframes relaydesk-pulse{0%,100%{box-shadow:0 0 0 0 rgba(230,47,137,.35),0 14px 34px rgba(17,19,27,.28)}50%{box-shadow:0 0 0 8px rgba(230,47,137,0),0 16px 38px rgba(17,19,27,.32)}}@media(prefers-reduced-motion:reduce){#relaydesk-chat-button,#relaydesk-chat-nudge{animation:none!important}}';
  button.id = 'relaydesk-chat-button';
  nudge.id = 'relaydesk-chat-nudge';
  button.style.animation = 'relaydesk-pulse 2.8s ease-in-out infinite';

  var chatIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>';
  var closeIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function syncUI(){
    iframe.style.display = open ? 'block' : 'none';
    button.innerHTML = open ? closeIcon : chatIcon;
    button.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    button.style.background = open ? '#e62f89' : '#171923';
    button.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    nudge.style.display = open ? 'none' : 'block';
  }

  button.addEventListener('click', function(){
    open = !open;
    syncUI();
  });
  nudge.addEventListener('click', function(){
    open = true;
    syncUI();
  });

  window.addEventListener('message', function(event){
    if (event.data === 'relaydesk:close') {
      open = false;
      syncUI();
    }
  });

  document.head.appendChild(style);
  document.body.appendChild(iframe);
  document.body.appendChild(nudge);
  document.body.appendChild(button);
  syncUI();
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
