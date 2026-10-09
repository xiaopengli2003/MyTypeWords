'use strict'
function showDemoView(view) {
  if (view === 'capture' || view === 'result') {
    enterPayload('A resilient system can recover from setbacks.')
    pickToken('resilient')
    if (view === 'result') {
      S.entry = demoEntry('resilient', '有韧性的；能迅速恢复的', S.payload)
      render()
    }
  } else switchView(view === 'settings' ? 'settings' : 'list')
}
showDemoView(new URLSearchParams(location.search).get('view') || 'capture')
window.addEventListener('message', e => {
  if (
    e.source !== window.parent ||
    e.origin !== location.origin ||
    !e.data ||
    e.data.type !== 'demo-view'
  )
    return
  showDemoView(e.data.view)
})
