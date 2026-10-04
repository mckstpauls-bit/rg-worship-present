const $ = (id) => document.getElementById(id);
function tick() { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
setInterval(tick, 1000); tick();
function fit() {
  const box = $('current');
  let lo = 20, hi = Math.round(window.innerHeight / 6), best = 20;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    box.style.fontSize = mid + 'px';
    if (box.scrollHeight <= box.clientHeight && box.scrollWidth <= box.clientWidth) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  box.style.fontSize = best + 'px';
}
window.addEventListener('resize', fit);
let cdTimer = null;
window.rg.on('output:render', (p) => {
  clearInterval(cdTimer);
  if (p.mode === 'countdown') {
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(p.until).getTime() - Date.now()) / 1000));
      const m = Math.floor(left / 60);
      $('current').textContent = `${m}:${String(left % 60).padStart(2, '0')}`;
      fit();
    };
    tick();
    cdTimer = setInterval(tick, 500);
    $('title').textContent = p.item.title || 'Countdown';
    $('state').textContent = 'COUNTDOWN';
    $('state').className = '';
    $('next').textContent = p.text || '';
    $('next').style.display = p.text ? '' : 'none';
    return;
  }
  $('title').textContent = (p.item && p.item.title) || 'RG-Present';
  const state = p.cover === 'black' ? 'BLACK' : p.cover === 'logo' ? 'LOGO' : p.cover === 'clear' ? 'CLEAR' : p.mode === 'media' ? 'MEDIA' : 'LIVE';
  $('state').textContent = (p.label ? p.label + '  ·  ' : '') + state;
  $('state').className = state === 'LIVE' ? 'live' : '';
  $('current').textContent = p.mode === 'slide' ? p.text || '' : '';
  $('next').textContent = p.next || '';
  $('next').style.display = p.next ? '' : 'none';
  fit();
});
