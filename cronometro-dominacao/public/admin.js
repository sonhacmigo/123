/* Painel do administrador: só quem tem a senha mexe nos pontos, equipes e regras. */
(function () {
  'use strict';
  var D = window.Dominacao, $ = D.$;
  var TOKEN_KEY = 'dominacao-admin-token';
  var PRESETS = [
    { n: 'Vermelho', c: '#c42d2d' }, { n: 'Azul', c: '#1d5fb5' }, { n: 'Verde', c: '#2e7d32' }, { n: 'Amarelo', c: '#e0b400' },
    { n: 'Laranja', c: '#e8710a' }, { n: 'Roxo', c: '#7b3fb0' }, { n: 'Rosa', c: '#d6407f' }, { n: 'Preto', c: '#1b1b1b' },
  ];

  var token = null, live = null, msgTimer = null;
  var tabEls = {}, panelEls = {}, pts = {}, devRows = {}, listRefs = {};
  var pointsSig = '', devSig = '', labelSig = '';
  var resetArmed = null, removeArmed = null;

  function loadToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function saveToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function flash(text, good) {
    var m = $('msg');
    m.textContent = text;
    m.className = 'msg' + (good ? ' good' : '');
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { m.textContent = ''; }, 4000);
  }

  /* ---------- Entrar e sair ---------- */
  function showLogin(text) {
    if (live) { live.stop(); live = null; }
    $('adminApp').hidden = true;
    $('login').hidden = false;
    D.setText($('loginMsg'), text || '');
    $('pwd').value = '';
    try { $('pwd').focus(); } catch (e) {}
  }
  function logout(text) {
    token = null; saveToken(null);
    showLogin(text);
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    D.setText($('loginMsg'), '');
    D.api('/api/admin/login', { password: $('pwd').value })
      .then(function (r) { token = r.token; saveToken(token); startApp(); })
      .catch(function (err) { D.setText($('loginMsg'), D.errorText(err)); });
  });
  $('btnLogout').addEventListener('click', function () { logout(''); });

  function boot() {
    token = loadToken();
    if (!token) return showLogin('');
    D.api('/api/admin', { action: 'ping' }, token)
      .then(startApp)
      .catch(function (e) { if (e.status === 401) logout('Sessão expirada. Entre de novo.'); else showLogin(D.errorText(e)); });
  }

  /* ---------- Ações ---------- */
  function act(action, payload) {
    return D.api('/api/admin', Object.assign({ action: action }, payload || {}), token)
      .then(function (r) { if (live && r.snapshot) live.apply(r.snapshot); return r; })
      .catch(function (e) {
        if (e.status === 401) logout('Sessão expirada. Entre de novo.');
        else flash(D.errorText(e));
        return null;
      });
  }
  function bind(input, send, wait) {
    var t = null;
    input.addEventListener('input', function () { if (!wait) return; clearTimeout(t); t = setTimeout(send, wait); });
    input.addEventListener('change', function () { clearTimeout(t); send(); });
  }

  /* ---------- Abas ---------- */
  function idxById(id) { var s = live && live.snap; if (!s) return -1; for (var i = 0; i < s.points.length; i++) if (s.points[i].id === id) return i; return -1; }
  function tabFromHash() {
    var h = ''; try { h = (location.hash || '').replace(/^#/, ''); } catch (e) {}
    if (h === 'inicio') return h;
    var m = /^ponto-(\d+)$/.exec(h);
    if (m && panelEls['ponto-' + m[1]]) return h;
    return 'inicio';
  }
  function showTab(name, updateHash) {
    if (name !== 'inicio' && !panelEls[name]) name = 'inicio';
    $('panel-inicio').hidden = name !== 'inicio';
    Object.keys(panelEls).forEach(function (k) { panelEls[k].hidden = k !== name; });
    Object.keys(tabEls).forEach(function (k) {
      tabEls[k].setAttribute('aria-selected', k === name ? 'true' : 'false');
      tabEls[k].tabIndex = k === name ? 0 : -1;
    });
    if (updateHash) { try { if (location.hash !== '#' + name) location.hash = name; } catch (e) {} }
    try { tabEls[name].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }
  function makeTab(name, label) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.setAttribute('role', 'tab');
    b.innerHTML = '<i class="tdot" data-o=""></i><span class="tname"></span>';
    b.querySelector('.tname').textContent = label;
    b.addEventListener('click', function () { showTab(name, true); });
    b.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var names = Object.keys(tabEls), i = names.indexOf(name);
      var next = names[(i + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length];
      showTab(next, true); tabEls[next].focus();
    });
    $('tabs').appendChild(b);
    tabEls[name] = b;
    return b;
  }

  /* ---------- Pontos ---------- */
  function buildPoints(d) {
    $('tabs').innerHTML = '';
    Object.keys(panelEls).forEach(function (k) { panelEls[k].remove(); });
    tabEls = {}; panelEls = {}; pts = {};
    var ti = makeTab('inicio', 'Início');
    ti.querySelector('.tdot').style.display = 'none';
    listRefs = D.buildList($('plist'), d.points, function (p) { showTab('ponto-' + p.id, true); });

    d.points.forEach(function (p) {
      var id = p.id, tabName = 'ponto-' + id, r = {};
      r.tab = makeTab(tabName, '');
      var sec = document.createElement('section');
      sec.className = 'panel'; sec.setAttribute('role', 'tabpanel'); sec.hidden = true;
      sec.innerHTML =
        '<div class="pname-field"><label for="pn-' + id + '">Nome do ponto</label><input class="pname" id="pn-' + id + '" type="text" maxlength="24" autocomplete="off"></div>' +
        '<div class="p-state" data-o="">Livre</div>' +
        '<div class="box"><h2 class="section-title">Correção do árbitro</h2>' +
          '<p class="note">Muda quem domina este ponto sem contar como captura e sem aviso sonoro.</p>' +
          '<div class="owner-btns"><button type="button" data-o="a"></button><button type="button" data-o="b"></button><button type="button" data-o="">Livre</button></div></div>' +
        '<div class="p-stats">' +
          '<div class="p-stat"><div class="who"><i class="dot" data-team="a"></i><span class="wn"></span></div><div class="big pa"></div><div class="small ta"></div></div>' +
          '<div class="p-stat"><div class="who"><i class="dot" data-team="b"></i><span class="wn"></span></div><div class="big pb"></div><div class="small tb"></div></div>' +
        '</div>' +
        '<div class="box"><h2 class="section-title">Aparelhos neste ponto</h2><p class="note devline"></p></div>' +
        '<div class="box"><h2 class="section-title">Regras deste ponto</h2>' +
          '<div class="fields">' +
            '<div class="field"><label for="ps-' + id + '">Segundos por ponto</label><input id="ps-' + id + '" type="number" min="1" max="3600" inputmode="numeric"><small>A cada intervalo com o ponto, 1 ponto</small></div>' +
            '<div class="field"><label for="pc-' + id + '">Pontos por captura</label><input id="pc-' + id + '" type="number" min="0" max="100" inputmode="numeric"></div>' +
            '<div class="field"><label for="ph-' + id + '">Segurar para dominar (s)</label><input id="ph-' + id + '" type="number" min="0" max="30" inputmode="numeric"><small>0 = basta um toque</small></div>' +
          '</div>' +
          '<div class="row-actions"><button class="sec warn" type="button" data-act="remove">Remover ponto</button></div>' +
          '<p class="note removenote" hidden>Para remover pontos, zere a partida.</p></div>';
      $('panels').appendChild(sec);
      panelEls[tabName] = sec;

      r.name = $('pn-' + id); r.sec = $('ps-' + id); r.cap = $('pc-' + id); r.hold = $('ph-' + id);
      r.state = sec.querySelector('.p-state');
      r.pa = sec.querySelector('.pa'); r.pb = sec.querySelector('.pb'); r.ta = sec.querySelector('.ta'); r.tb = sec.querySelector('.tb');
      r.wn = sec.querySelectorAll('.wn');
      r.owners = sec.querySelectorAll('.owner-btns button');
      r.devline = sec.querySelector('.devline');
      r.remove = sec.querySelector('[data-act="remove"]'); r.removeNote = sec.querySelector('.removenote');

      bind(r.name, function () { act('point_update', { id: id, name: r.name.value }); }, 500);
      bind(r.sec, function () { act('point_update', { id: id, sec: r.sec.value }); }, 0);
      bind(r.cap, function () { act('point_update', { id: id, cap: r.cap.value }); }, 0);
      bind(r.hold, function () { act('point_update', { id: id, hold: r.hold.value }); }, 0);
      Array.prototype.forEach.call(r.owners, function (b) {
        b.addEventListener('click', function () { act('owner', { pointId: id, owner: b.dataset.o || null }); });
      });
      r.remove.addEventListener('click', function () {
        if (removeArmed !== id) {
          disarmRemove();
          removeArmed = id; r.remove.textContent = 'Confirmar remoção?';
          r.removeTimer = setTimeout(disarmRemove, 3000);
          return;
        }
        disarmRemove();
        act('point_remove', { id: id }).then(function (res) { if (res) showTab('inicio', true); });
      });
      pts[id] = r;
    });
  }
  function disarmRemove() {
    if (removeArmed === null) return;
    var r = pts[removeArmed];
    if (r) { clearTimeout(r.removeTimer); r.remove.textContent = 'Remover ponto'; }
    removeArmed = null;
  }

  /* ---------- Aparelhos ---------- */
  function buildDevices(s) {
    $('devs').innerHTML = '';
    devRows = {};
    s.devices.forEach(function (dev) {
      var id = dev.id, row = document.createElement('div');
      row.className = 'dev';
      row.innerHTML =
        '<input type="text" maxlength="24" autocomplete="off" aria-label="Nome do aparelho">' +
        '<span class="chip">Offline</span>' +
        '<div class="sel"><select aria-label="Ponto deste aparelho"></select></div>' +
        '<div class="dev-actions"><button class="sec" type="button" data-act="newpoint">Criar ponto para este aparelho</button>' +
        '<button class="sec warn" type="button" data-act="forget">Esquecer aparelho</button></div>';
      $('devs').appendChild(row);
      var r = { row: row, name: row.querySelector('input'), chip: row.querySelector('.chip'), sel: row.querySelector('select'), player: '' };
      bind(r.name, function () { act('device_rename', { deviceId: id, name: r.name.value }); }, 600);
      r.sel.addEventListener('change', function () {
        act('device_assign', { deviceId: id, pointId: r.sel.value === '' ? null : parseInt(r.sel.value, 10) });
      });
      row.querySelector('[data-act="newpoint"]').addEventListener('click', function () { act('point_add', { deviceId: id }); });
      var forget = row.querySelector('[data-act="forget"]');
      forget.addEventListener('click', function () {
        if (forget.dataset.armed !== '1') {
          forget.dataset.armed = '1'; forget.textContent = 'Confirmar?';
          setTimeout(function () { forget.dataset.armed = ''; forget.textContent = 'Esquecer aparelho'; }, 3000);
          return;
        }
        act('device_remove', { deviceId: id });
      });
      devRows[id] = r;
    });
  }

  /* ---------- Equipes e cores ---------- */
  var customInputs = {};
  function presetByColor(c) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].c === c) return PRESETS[i]; return null; }
  function setColor(k, color) {
    var s = live && live.snap;
    if (!s) return;
    var cur = k === 'a' ? s.config.colorA : s.config.colorB;
    var curName = k === 'a' ? s.config.nameA : s.config.nameB;
    var prev = presetByColor(cur), next = presetByColor(color), payload = {};
    payload[k === 'a' ? 'colorA' : 'colorB'] = color;
    if (next && (!curName || (prev && curName === prev.n))) payload[k === 'a' ? 'nameA' : 'nameB'] = next.n;
    act('config', payload);
  }
  function buildSwatches(k, box) {
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.style.background = p.c;
      b.setAttribute('aria-label', p.n); b.title = p.n; b.dataset.color = p.c;
      b.addEventListener('click', function () { setColor(k, p.c); });
      box.appendChild(b);
    });
    var lab = document.createElement('label');
    lab.className = 'custom';
    lab.appendChild(document.createTextNode('Outra'));
    var inp = document.createElement('input');
    inp.type = 'color'; inp.id = 'cfgColor' + k.toUpperCase();
    inp.addEventListener('change', function () { setColor(k, inp.value); });
    lab.appendChild(inp);
    box.appendChild(lab);
    customInputs[k] = inp;
  }
  buildSwatches('a', $('swA'));
  buildSwatches('b', $('swB'));
  bind($('cfgNameA'), function () { act('config', { nameA: $('cfgNameA').value }); }, 500);
  bind($('cfgNameB'), function () { act('config', { nameB: $('cfgNameB').value }); }, 500);
  bind($('cfgDuration'), function () { act('config', { duration: $('cfgDuration').value }); }, 0);

  /* ---------- Comandos ---------- */
  $('btnStart').addEventListener('click', function () {
    var s = live && live.snap;
    if (!s || s.run.status === 'ended') return;
    act(s.run.status === 'running' ? 'pause' : 'start');
  });
  $('btnAdd').addEventListener('click', function () {
    act('point_add').then(function (r) { if (r && r.pointId) showTab('ponto-' + r.pointId, true); });
  });
  $('btnNewPoints').addEventListener('click', function () { act('devices_new_points'); });
  $('btnReset').addEventListener('click', function () {
    var b = $('btnReset');
    if (!resetArmed) {
      b.textContent = 'Confirmar?'; b.classList.add('warn');
      resetArmed = setTimeout(disarmReset, 3000);
      return;
    }
    disarmReset();
    act('reset');
  });
  function disarmReset() {
    clearTimeout(resetArmed); resetArmed = null;
    $('btnReset').textContent = 'Zerar partida'; $('btnReset').classList.remove('warn');
  }
  $('linkTerminal').textContent = location.origin + '/';
  $('linkPlacar').textContent = location.origin + '/placar';
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (b) {
    b.addEventListener('click', function () {
      var el = $(b.dataset.copy), text = el.textContent;
      function select() { try { var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {} }
      try {
        navigator.clipboard.writeText(text).then(function () { flash('Link copiado.', true); }, function () { select(); flash('Selecionei o link. Copie com o menu do aparelho.'); });
      } catch (e) { select(); flash('Selecionei o link. Copie com o menu do aparelho.'); }
    });
  });

  /* ---------- Desenho da tela ---------- */
  function setValue(input, value) { if (!D.focused(input) && input.value !== String(value)) input.value = String(value); }

  function render() {
    var d = D.derive(live), s = live && live.snap;
    if (!d || !s) return;
    D.syncColors(d.cfg);
    var c = D.clock(d);
    D.setText($('clockLabel'), c.label);
    D.setText($('clockTime'), c.text);
    $('status').dataset.s = d.status === 'running' ? 'run' : d.status === 'ended' ? 'end' : 'idle';
    D.setText($('status'), D.statusText(d.status));
    var b = $('btnStart');
    D.setText(b, d.status === 'ended' ? 'Fim' : d.status === 'running' ? 'Pausar' : d.status === 'paused' ? 'Continuar' : 'Iniciar');
    b.disabled = d.status === 'ended';

    var res = $('result');
    res.hidden = d.status !== 'ended';
    if (d.status === 'ended') { var r = D.result(d); D.setText($('resultTitle'), r.title); D.setText($('resultText'), r.text); }

    D.renderBoard(d);
    D.renderList(listRefs, d);

    d.points.forEach(function (p, i) {
      var r = pts[p.id], a = d.areas[p.id];
      if (!r) return;
      var label = D.pointLabel(p, i);
      D.setText(r.tab.querySelector('.tname'), label);
      r.tab.querySelector('.tdot').dataset.o = a.owner || '';
      setValue(r.name, p.name); r.name.placeholder = 'Ponto ' + (i + 1);
      setValue(r.sec, p.sec); setValue(r.cap, p.cap); setValue(r.hold, p.hold);
      r.state.dataset.o = a.owner || '';
      D.setText(r.state, a.owner ? 'Dominado: ' + D.teamName(d.cfg, a.owner) : 'Livre');
      D.setText(r.pa, D.pointScore(p, a, 'a') + ' pts');
      D.setText(r.pb, D.pointScore(p, a, 'b') + ' pts');
      D.setText(r.ta, D.fmt(a.t.a) + ' de posse · ' + a.caps.a + (a.caps.a === 1 ? ' captura' : ' capturas'));
      D.setText(r.tb, D.fmt(a.t.b) + ' de posse · ' + a.caps.b + (a.caps.b === 1 ? ' captura' : ' capturas'));
      D.setText(r.wn[0], D.teamName(d.cfg, 'a')); D.setText(r.wn[1], D.teamName(d.cfg, 'b'));
      D.setText(r.owners[0], D.teamName(d.cfg, 'a')); D.setText(r.owners[1], D.teamName(d.cfg, 'b'));
      r.owners[0].classList.toggle('on', a.owner === 'a');
      r.owners[1].classList.toggle('on', a.owner === 'b');
      r.owners[2].classList.toggle('on', !a.owner);
      var here = (s.devices || []).filter(function (dv) { return dv.pointId === p.id; });
      D.setText(r.devline, here.length ? here.map(function (dv) { return dv.name + (dv.online ? ' (online)' : ' (offline)') + (dv.player ? ' · ' + dv.player : ''); }).join(', ') : 'Nenhum aparelho neste ponto. Atribua um em Início, na lista de aparelhos.');
      r.remove.disabled = d.status !== 'idle' || d.points.length <= 1;
      r.removeNote.hidden = d.status === 'idle';
    });

    /* aparelhos */
    $('devEmpty').hidden = s.devices.length > 0;
    $('btnNewPoints').disabled = !s.devices.some(function (dv) { return dv.pointId == null; });
    s.devices.forEach(function (dv) {
      var r = devRows[dv.id];
      if (!r) return;
      setValue(r.name, dv.name);
      r.chip.className = 'chip' + (dv.online ? ' on' : '');
      D.setText(r.chip, dv.online ? 'Online' : 'Offline');
      if (!D.focused(r.sel)) r.sel.value = dv.pointId == null ? '' : String(dv.pointId);
    });
    var anyUnassigned = s.devices.some(function (dv) { return dv.pointId == null; });
    $('btnNewPoints').title = anyUnassigned ? '' : 'Todos os aparelhos já têm ponto';
    $('btnAdd').disabled = d.points.length >= 12;

    /* equipes */
    setValue($('cfgNameA'), d.cfg.nameA); setValue($('cfgNameB'), d.cfg.nameB); setValue($('cfgDuration'), d.cfg.duration);
    [['a', $('swA'), d.cfg.colorA], ['b', $('swB'), d.cfg.colorB]].forEach(function (t) {
      var btns = t[1].querySelectorAll('.sw');
      for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', btns[i].dataset.color === t[2] ? 'true' : 'false');
      customInputs[t[0]].value = t[2];
    });
    $('colorWarn').hidden = d.cfg.colorA !== d.cfg.colorB;
  }

  function options(s) {
    var html = '<option value="">Sem ponto</option>';
    s.points.forEach(function (p, i) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = D.pointLabel(p, i);
      html += o.outerHTML;
    });
    return html;
  }
  function onSnapshot(s) {
    var curTab = null;
    Object.keys(tabEls).forEach(function (k) { if (tabEls[k].getAttribute('aria-selected') === 'true') curTab = k; });
    var changed = false;
    var ps = D.pointsSig(s.points);
    if (ps !== pointsSig) {
      pointsSig = ps; changed = true;
      buildPoints(D.derive(live));
      showTab(curTab && (curTab === 'inicio' || panelEls[curTab]) ? curTab : tabFromHash(), false);
    }
    var ds = s.devices.map(function (x) { return x.id; }).join(',');
    if (ds !== devSig) { devSig = ds; changed = true; buildDevices(s); }
    var ls = s.points.map(function (p, i) { return p.id + ':' + D.pointLabel(p, i); }).join('|');
    if (ls !== labelSig || changed) {
      labelSig = ls;
      var html = options(s);
      Object.keys(devRows).forEach(function (id) { var sel = devRows[id].sel; if (!D.focused(sel)) { sel.innerHTML = html; } });
    }
    render();
  }

  function startApp() {
    $('login').hidden = true;
    $('adminApp').hidden = false;
    flash('');
    pointsSig = ''; devSig = ''; labelSig = '';
    live = new D.Live('/api/stream?role=admin&token=' + encodeURIComponent(token));
    D.bindBanner($('banner'), live);
    D.keepAwake(live);
    live.on('snapshot', onSnapshot);
    live.on('game', function (ev) { D.Sound.handle(ev, 'admin'); });
    live.on('fatal', function () {
      D.api('/api/admin', { action: 'ping' }, token).catch(function (e) { if (e.status === 401) logout('Sessão expirada. Entre de novo.'); });
    });
    live.start();
  }

  D.Sound.mount($('soundBtn'));
  window.addEventListener('hashchange', function () { if (live && live.snap) showTab(tabFromHash(), false); });
  setInterval(function () { if (live && live.snap && !$('adminApp').hidden) render(); }, 100);
  boot();
})();
