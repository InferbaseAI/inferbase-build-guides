/*
 * Add the support agent to any site:
 *
 *   <script src="https://YOUR-DEPLOYMENT/embed.js" async></script>
 *
 * Optional attributes on the script tag:
 *   data-label="Ask a question"   the launcher's text
 *   data-bottom="24"              distance from the bottom edge in px (raise it above a cookie banner)
 *
 * The chat runs in a frame on its own origin, so it shares no cookies, storage or styles with your
 * site. Allow your site in the deployment's FRAME_ANCESTORS.
 */
(function () {
  var script = document.currentScript
  if (!script || window.__supportAgentEmbedded) return
  window.__supportAgentEmbedded = true
  var origin = new URL(script.src).origin
  var label = script.getAttribute('data-label') || 'Ask a question'
  var bottom = Number(script.getAttribute('data-bottom') || 24)

  var button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', 'support-agent-frame')
  button.style.cssText =
    'position:fixed;right:24px;bottom:' + bottom + 'px;z-index:2147483000;padding:10px 16px;border:0;border-radius:8px;' +
    'background:#1d4ed8;color:#fff;font:500 14px/1.2 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer'

  var frame = document.createElement('iframe')
  frame.id = 'support-agent-frame'
  frame.title = 'Support chat'
  frame.src = origin + '/?embed=1'
  frame.style.cssText =
    'position:fixed;right:24px;bottom:' + (bottom + 52) + 'px;z-index:2147483000;width:min(420px,calc(100vw - 32px));' +
    'height:min(600px,calc(100vh - ' + (bottom + 80) + 'px));border:1px solid rgba(0,0,0,.12);border-radius:10px;' +
    'background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.2);display:none'

  button.addEventListener('click', function () {
    var open = frame.style.display === 'none'
    frame.style.display = open ? 'block' : 'none'
    button.setAttribute('aria-expanded', String(open))
    button.textContent = open ? 'Close' : label
  })
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && frame.style.display !== 'none') button.click()
  })

  document.body.appendChild(frame)
  document.body.appendChild(button)
})()
