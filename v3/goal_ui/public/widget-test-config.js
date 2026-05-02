// External config for widget-test.html so the page satisfies the
// same-origin CSP envelope (no `'unsafe-inline'` on script-src).
window.RufloResearchWidgetConfig = {
  primaryColor: '#8b5cf6',
  title: 'Test Widget Title',
  brandName: 'TEST-WIDGET',
};

window.addEventListener('load', function () {
  var status = document.getElementById('widget-status');
  if (!status) return;
  if (window.RufloResearchWidget) {
    status.textContent = 'widget=loaded';
    status.dataset.widgetState = 'loaded';
  } else {
    status.textContent = 'widget=missing';
    status.dataset.widgetState = 'missing';
  }
});
