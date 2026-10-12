// Two or three players, each on their own phone: the screens to pair them (a room code
// or QR codes), the lobby, and the championship kept in step. Player 1's phone (the
// host) runs it all: the simulation, the money and the shops. The others (guests) send
// their controls and draw the race the host sends (js/net/netplay.js), their screens
// following the host's: results, shop (purchases go through the host), podium and
// game over. Installed into Game so the screens use the game's own helpers.

import { h, esc } from '../ui/ui.js';
import { Race, mine } from '../sim/race.js';
import { Session } from './session.js';
import { NetPlay } from '../net/netplay.js';
import { applyState, writeTruck } from '../net/state.js';
import { qrCanvas, QRScanner } from '../net/qr.js';
import { ASSIST_LEVELS, SteerAssist } from '../sim/assist.js';
import { TruckSim } from '../sim/truck.js';
import { wrapAngle } from '../sim/util.js';
import { quantize } from './replay.js';
import { lanKey, LanBeacon, LanFinder } from '../net/lan.js';
import { VERSION } from '../version.js';

const DT = 1 / 120;
const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORD = { 2: 'DOS', 3: 'TRES' };

// why a connection did not happen, for people
function netError(e) {
  const m = (e && e.message) || '';
  if (m.startsWith('version:')) return `Un móvil tiene otra versión del juego (v${esc(m.slice(8))}). Abrid todos el juego con internet para que se actualicen.`;
  if (m === 'notfound') return 'No encuentro esa partida. Revisa el código y que el otro móvil siga en CREAR PARTIDA.';
  if (m === 'busy') return 'Esa partida ya ha empezado.';
  if (m === 'full') return 'Esa partida ya está completa.';
  if (m === 'nolink') return 'No se han podido conectar. ¿Estáis todos en la misma WiFi?';
  if (m === 'notours') return 'Ese QR no es de una partida de Super Off Road.';
  if (m === 'insecure') return 'La cámara solo funciona en la web publicada del juego (https).';
  if (m === 'denied') return 'Sin permiso para la cámara: actívalo en los ajustes del navegador y vuelve a probar.';
  if (m === 'nocamera') return 'Este aparato no tiene cámara. Conectad con código, o que este sea un móvil que se une.';
  return 'Sin conexión con el servidor de códigos (¿sin internet?). Conectad con QR: no necesita internet.';
}

export function installNet(Game) {
  Object.assign(Game.prototype, {
    // ---------------------------------------------------------------- menus
    // 2 or 3 JUGADORES: each on their own phone over the WiFi, or all on this device
    toMultiPlayers(n, local) {
      this.ui.hide('menu');
      const el = this.ui.show('two', `<div class="panel fade-in"><div class="head">${n} JUGADORES</div>
        <div class="menu">
          <div class="btn cont-btn${isTouch() ? ' primary' : ''}" data-a="net"><span>EN ${WORD[n]} MÓVILES</span><small>CADA UNO EN EL SUYO · POR WIFI</small></div>
          <div class="btn cont-btn" data-a="local"><span>EN ESTE APARATO</span><small>CON MANDOS O TECLADO</small></div>
          <div class="btn" data-a="back">VOLVER</div>
        </div></div>`);
      const back = () => { this.ui.hide('two'); this.toMenu(); };
      this.ui.navigate('two', [...el.querySelectorAll('.btn')], {
        start: isTouch() ? 0 : 1, // phones: each on their own; a computer: pads or keyboard here
        onOk: (i, b) => {
          if (b.dataset.a === 'back') return back();
          this.ui.hide('two');
          if (b.dataset.a === 'net') this.toNetMenu(n); else local();
        },
        onBack: back,
      });
    },

    // the several-phone menu: the games announced on this WiFi (found by themselves,
    // kept up to date), create or join with a code, or with QR codes without internet
    toNetMenu(n = 2) {
      let finder = null, first = true, list = null;
      const stop = () => { if (finder) finder.stop(); finder = null; };
      const go = (fn) => { stop(); this.ui.hide('netmenu'); fn(); };
      const back = () => go(() => this.toMenu());
      const found = () => {
        if (list === null) return '<span class="muted"><i class="spin"></i>Buscando partidas en esta WiFi…</span>';
        if (list === 'off') return '<span class="muted">Sin internet no se pueden buscar: usad los QR.</span>';
        if (!list.length) return '<span class="muted"><i class="spin"></i>Ninguna todavía: que alguien pulse CREAR PARTIDA.</span>';
        return list.map((g) => (g.v !== VERSION
          ? `<div class="btn found disabled" data-code="${g.code}">PARTIDA ${g.code} <span class="val">OTRA VERSIÓN (v${esc(g.v)})</span></div>`
          : `<div class="btn primary found" data-code="${g.code}">UNIRSE A LA PARTIDA ${g.code} <span class="val">${g.n}/${g.max}</span></div>`)).join('');
      };
      const render = (keep) => {
        const el = this.ui.show('netmenu', `<div class="panel${first ? ' fade-in' : ''} net-panel"><div class="head">EN ${WORD[n]} MÓVILES</div>
          <div class="nethelp">Todos con el juego abierto y en la misma WiFi (o conectados al punto de acceso de uno de los móviles). Uno crea la partida y los demás se unen.</div>
          <div class="netfound"><div class="nethelp sub">En esta WiFi</div><div class="foundlist">${found()}</div></div>
          <div class="menu cols2 netgrid">
            <div class="btn primary" data-a="host">CREAR PARTIDA</div>
            <div class="btn" data-a="join">UNIRSE CON CÓDIGO</div>
            <div class="nethelp sub">Sin internet, con QR:</div>
            <div class="btn" data-a="qrhost">CREAR CON QR</div>
            <div class="btn" data-a="qrjoin">UNIRSE CON QR</div>
            <div class="btn" data-a="back">VOLVER</div>
          </div></div>`);
        first = false;
        const btns = [...el.querySelectorAll('.btn')];
        const start = Math.max(0, btns.findIndex((b) => keep && (b.dataset.code === keep || b.dataset.a === keep)));
        const nav = this.ui.navigate('netmenu', btns, {
          start,
          onOk: (i, b) => {
            if (b.dataset.code) return go(() => this._netJoin(n, b.dataset.code));
            const a = b.dataset.a;
            if (a === 'back') return back();
            go(() => { if (a === 'host') this._netHost(n, 'code'); else if (a === 'qrhost') this._netHost(n, 'qr'); else if (a === 'join') this._netJoin(n); else this._netQRJoin(n); });
          },
          onBack: back,
        });
        return { el, nav };
      };
      let cur = render();
      const update = (l) => {
        if (!cur.el.isConnected) { stop(); return; }
        const f = cur.nav.els[cur.nav.i];
        list = l;
        cur = render(f && (f.dataset.code || f.dataset.a));
      };
      lanKey().then((key) => {
        if (!cur.el.isConnected) return;
        if (!key) { update('off'); return; }
        finder = new LanFinder((l) => update(l), () => cur.el.isConnected);
        this._lanFinder = finder; // tests
        finder.start(key).catch(() => { if (cur.el.isConnected) update('off'); });
      });
    },

    // a new connection, wired to the game
    _netNew(role) {
      if (this.net) this.net.close();
      const net = (this.net = new NetPlay(role));
      net.debug = /[?&]netdebug/.test(location.search);
      net.prefs = { assist: this.opt.assist };
      net.ready = {};
      // (only while this is still the game's connection: a goodbye takes a moment)
      net.onstall = (p, on) => { if (this.net === net) this._netStall(p, on); };
      net.onlost = (p) => { if (this.net === net) this._netLost(p); };
      net.onrejoin = (p) => { if (this.net === net) this._netRejoined(p); };
      const on = (t, fn) => net.on(t, (m, from) => { if (this.net === net) fn(m, from); });
      on('bye', (m, from) => this._netGone(from));
      // a phone building a circuit: a few busy seconds without a word
      on('loading', (m, from) => { net.hushPeer(from, 40000); if (net.debug) console.info(`[net] player ${from + 1} busy`); });
      on('loaded', (m, from) => { net.hushPeer(from, 0); if (net.debug) console.info(`[net] player ${from + 1} free`); });
      on('pause', (m, from) => {
        if ((this.state === 'race' || this.state === 'intro') && !this.paused) this.pause(true);
        if (net.role === 'host') net.send({ t: 'pause' }, [from]); // and the third phone
      });
      on('resume', (m, from) => {
        if (this.paused) this.resume(true);
        if (net.role === 'host') net.send({ t: 'resume' }, [from]);
      });
      if (role === 'host') {
        net.onjoin = (p) => { if (this.net === net) this._netJoined(p); };
        on('skip', () => this._skipIntro(true));
        on('pick', (m, from) => this._netGuestPick(m, from));
        on('ready', (m, from) => this._netReadyFrom(m.k, from));
        on('buy', (m, from) => this._netBuy(m, from));
        on('paint', (m, from) => this._netPaint(m, from));
        on('prefs', (m, from) => {
          const peer = net.peerOf(from);
          if (peer) peer.prefs.assist = m.assist;
          const l = ASSIST_LEVELS[m.assist] || 0, a = this.assists && this.assists[from];
          if (a) a.level = l;
          if (this.race && !this.race.shadow && this.race.state !== 'done' && this.assistBy) this.assistBy[from] = Math.max(this.assistBy[from] || 0, l);
        });
      } else {
        on('seat', (m) => { net.local = m.player; });
        on('lobby', (m) => this._netLobby(m));
        on('race', (m) => this._guestRace(m));
        on('ev', (m) => net.evq.push(m));
        on('introdone', () => { if (this.state === 'intro') this.introT = this.introHold; });
        on('done', (m) => this._guestDone(m));
        on('podium', (m) => { this.session = this._mirror(m.sess); this._fade(() => this.toPodium(m.cup, () => this._netReady('podium'))); });
        on('shop', (m) => { this.session = this._mirror(m.sess); this._fade(() => { this.ui.hideAll(); this.toShop(0); }); });
        on('sess', (m) => this._netSess(m));
        on('gameover', (m) => { this.session = this._mirror(m.sess); this._fade(() => this.toGameOver()); });
        on('cont', () => this.ui.toast('¡Seguimos!', 'money', 1500));
        on('left', (m) => this.ui.toast(`El jugador ${m.player + 1} ha salido<br><span class="sub">Su camión sigue para la CPU</span>`, 'small warn', 2600));
      }
      return net;
    },
    // a guest's copy of the championship (what the host sent last)
    _mirror(sess) {
      const s = Session.restore(sess, true) || this.session;
      s.net = true;
      return s;
    },

    // ---------------------------------------------------------------- the host's room
    // CREAR PARTIDA (a 4-digit code) or CREAR CON QR (one code per phone that joins):
    // the players connected so far, and EMPEZAR when everyone is in
    async _netHost(n, mode) {
      const net = this._netNew('host');
      net.max = n; net.mode = mode;
      this._netRoom();
      if (mode === 'qr') return; // the room starts the camera and the first QR
      try {
        await net.hostCode();
        if (this.net !== net) return;
        this._netRoomCode();
        this._netBeacon();
      } catch (e) {
        if (this.net !== net) return;
        net.codeError = netError(e);
        this._netRoomCode();
      }
    },
    // the room on screen (again after someone left while choosing: the same code)
    _netRoom() {
      const net = this.net, n = net.max, qr = net.mode === 'qr';
      const el = this.ui.show('nethost', `<div class="panel fade-in net-panel${qr ? ' qr-panel' : ''}"><div class="head">${qr ? 'CREAR CON QR' : 'CREAR PARTIDA'}</div>
        ${qr ? `<div class="qrwrap">
          <div class="qrcol"><div class="qrstep"><b>1</b> El otro móvil escanea este QR<br><small>UNIRSE CON QR</small></div><div class="qrbox" data-k="qr"><i class="spin"></i></div></div>
          <div class="qrcol"><div class="qrstep"><b>2</b> Enfoca aquí el QR que salga en el otro móvil</div><div class="camview"><video playsinline muted></video><i class="frame"></i></div></div>
        </div>` : '<div class="netcode"><span class="spin"></span></div>'}
        <div class="nethelp" data-k="msg">${qr ? '' : 'Preparando el código…'}</div>
        <div class="netplayers">${Array.from({ length: n }, (_, i) => `<span data-p="${i}" class="${i ? '' : 'in'}">${i ? `JUGADOR ${i + 1}` : 'JUGADOR 1 · TÚ'}</span>`).join('')}</div>
        <div class="menu row-menu" style="padding-top:2px"><div class="btn primary disabled" data-a="go">EMPEZAR</div>${qr ? '' : '<div class="btn" data-a="qr">CON QR</div>'}<div class="btn" data-a="back">CANCELAR</div></div></div>`);
      const L = (net.lobby = { el, n, qr });
      const cancel = () => { if (net.scanner) net.scanner.stop(); this.ui.hide('nethost'); this.netLeave(true); this.toNetMenu(n); };
      L.nav = this.ui.navigate('nethost', [...el.querySelectorAll('.btn')], {
        axis: 'h', start: 1,
        onOk: (i, b) => {
          if (b.dataset.a === 'back') return cancel();
          if (b.dataset.a === 'qr') { if (net.guests.length) return; this.ui.hide('nethost'); this.netLeave(false); this._netHost(n, 'qr'); return; }
          if (b.dataset.a === 'go') this._netStart();
        },
        onBack: cancel,
      });
      this._netPlayers();
      if (qr) this._netRoomQR(); else this._netRoomCode();
    },
    _netRoomCode() {
      const net = this.net, L = net && net.lobby;
      if (!L || L.qr || !L.el.isConnected) return;
      const msg = L.el.querySelector('[data-k=msg]'), box = L.el.querySelector('.netcode');
      if (net.code) {
        box.innerHTML = net.code.split('').map((d) => `<b>${d}</b>`).join('');
        msg.innerHTML = `En los otros móviles: <b>${L.n} JUGADORES → EN ${WORD[L.n]} MÓVILES</b>. En esta WiFi les sale la partida sola; si no, que pulsen UNIRSE CON CÓDIGO y escriban este.`;
      } else if (net.codeError) {
        box.innerHTML = '<b class="off">—</b>';
        msg.textContent = net.codeError;
        L.nav.focus(1, true);
      }
      this.ui.fit(L.el);
    },
    // the room announced to the phones of this WiFi (until EMPEZAR)
    _netBeacon() {
      const net = this.net;
      if (!net || net.mode !== 'code' || !net.code || net.beacon) return;
      lanKey().then((key) => {
        if (!key || this.net !== net || net.locked || net.beacon) return;
        net.beacon = new LanBeacon(() => (net.locked ? null : { code: net.code, n: 1 + net.guests.length, max: net.max }));
        net.beacon.start(key);
      });
    },
    // the camera to read the phones that join, and our QR for the next one
    async _netRoomQR() {
      const net = this.net, L = net.lobby, el = L.el;
      const msg = el.querySelector('[data-k=msg]');
      if (net.scanner) net.scanner.stop();
      const scanner = (net.scanner = new QRScanner(el.querySelector('video')));
      // the camera first: with it on, the phone gives its real WiFi address to the code
      await scanner.start().catch((e) => { L.camMsg = netError(e); msg.textContent = L.camMsg; });
      if (this.net !== net || !el.isConnected) { scanner.stop(); return; }
      await this._netNextQR();
      let reading = false;
      scanner.onresult = async (t) => {
        const box = el.querySelector('[data-k=qr]');
        if (reading || t === (box && box.dataset.text)) return; // its own code seen in a reflection
        reading = true;
        msg.innerHTML = '<i class="spin"></i>Conectando…';
        try { await net.acceptQR(t); } catch (e) { if (this.net === net) { msg.textContent = netError(e); this.audio.ui('deny'); } }
        reading = false;
      };
    },
    // someone left while the others were choosing: back to the room, the same code
    _netBackToRoom() {
      const net = this.net;
      net.locked = false;
      this._netPicks = null;
      net.send({ t: 'lobby', p: 'room' });
      this.ui.hideAll();
      this._netRoom();
      this._netBeacon();
    },
    // the QR for the next phone (one offer per phone)
    async _netNextQR() {
      const net = this.net, L = net && net.lobby;
      if (!L || !L.qr || !L.el.isConnected) return;
      const box = L.el.querySelector('[data-k=qr]');
      if (net.guests.length >= L.n - 1) { box.innerHTML = '<b class="qrfull">✓</b>'; delete box.dataset.text; return; }
      box.innerHTML = '<i class="spin"></i>';
      const text = await net.hostQR();
      if (this.net !== net || !L.el.isConnected) return;
      box.innerHTML = '';
      box.appendChild(qrCanvas(text, 300));
      box.dataset.text = text;
      L.el.querySelector('[data-k=msg]').textContent = L.camMsg || (net.guests.length ? 'Ahora el siguiente móvil: UNIRSE CON QR.' : '');
      this.ui.fit(L.el);
    },
    // the room's list of players
    _netPlayers() {
      const net = this.net, L = net && net.lobby;
      if (!L || !L.el.isConnected) return;
      const inn = new Set([0, ...net.guests.map((p) => p.player)]);
      L.el.querySelectorAll('.netplayers span').forEach((s) => {
        const p = +s.dataset.p;
        s.classList.toggle('in', inn.has(p));
        s.innerHTML = p ? `JUGADOR ${p + 1}${inn.has(p) ? ' ✓' : ' <i class="spin"></i>'}` : 'JUGADOR 1 · TÚ';
      });
      const go = L.el.querySelector('[data-a=go]');
      go.classList.toggle('disabled', inn.size < 2);
      go.textContent = inn.size < 2 ? 'EMPEZAR' : `EMPEZAR (${inn.size} JUGADORES)`;
      this.ui.fit(L.el);
    },
    _netJoined(p) {
      this.audio.ui('ok');
      this.ui.toast(`¡Jugador ${p + 1} conectado!`, 'money', 1500);
      this._wake(true);
      this._netPlayers();
      if (this.net.lobby && this.net.lobby.qr) this._netNextQR();
    },
    // EMPEZAR: no more players (a QR left waiting for another phone goes) and the difficulty
    _netStart() {
      const net = this.net;
      if (!net || net.guests.length < 1) return;
      net.locked = true;
      if (net.scanner) net.scanner.stop();
      if (net.beacon) { net.beacon.close(); net.beacon = null; } // no longer on the WiFi's list
      for (const p of net.peers.filter((x) => !x.open)) { net.peers.splice(net.peers.indexOf(p), 1); p.close(); }
      this._netSeats();
      net.lobby = null;
      this.ui.hide('nethost');
      net.send({ t: 'lobby', p: 'diff' });
      this.toDifficulty(1 + net.guests.length);
    },

    // ---------------------------------------------------------------- joining
    // UNIRSE: the code on a keypad (or the keyboard's digits)
    _netJoin(n = 2, preset = '') {
      let code = '';
      const el = this.ui.show('netjoin', `<div class="panel fade-in net-panel"><div class="head">UNIRSE</div>
        <div class="netcode entry">${'<b></b>'.repeat(4)}</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<div class="btn key" data-d="${d}">${d}</div>`).join('')}<div class="btn key" data-d="del">⌫</div><div class="btn key" data-d="0">0</div><div class="btn key primary" data-d="ok">OK</div></div>
        <div class="nethelp" data-k="msg">Escribe el código que enseña el móvil que ha creado la partida.</div>
        <div class="menu row-menu" style="padding-top:2px"><div class="btn" data-a="qr">CON QR (SIN INTERNET)</div><div class="btn" data-a="back">VOLVER</div></div></div>`);
      const boxes = [...el.querySelectorAll('.netcode b')];
      const msg = el.querySelector('[data-k=msg]');
      let busy = false;
      const paint = () => boxes.forEach((b, i) => { b.textContent = code[i] || ''; b.classList.toggle('cur', i === code.length && !busy); });
      const leave = () => { window.removeEventListener('keydown', keys, true); };
      const cancel = () => { leave(); this.ui.hide('netjoin'); this.netLeave(false); this.toNetMenu(n); };
      const go = async () => {
        if (busy || code.length < 4) return;
        busy = true; paint();
        msg.innerHTML = `<i class="spin"></i>Conectando con la partida ${code}…`;
        const net = this._netNew('guest');
        try {
          await net.joinCode(code);
          if (this.net !== net) return;
          leave(); this.ui.hide('netjoin');
          this._netConnected();
        } catch (e) {
          if (this.net !== net) return;
          net.log('join failed:', e.message, net.peers.map((p) => p.link.pc.iceConnectionState));
          this.netLeave(false);
          busy = false; code = ''; paint();
          msg.textContent = netError(e);
          this.audio.ui('deny');
        }
      };
      const press = (d) => {
        if (busy) return;
        if (d === 'del') code = code.slice(0, -1);
        else if (d === 'ok') return go();
        else if (code.length < 4) code += d;
        paint();
        if (code.length === 4) go();
      };
      const keys = (e) => {
        if (!this.ui.get('netjoin')) return leave();
        if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); } else if (e.key === 'Backspace') { press('del'); e.preventDefault(); e.stopPropagation(); }
      };
      window.addEventListener('keydown', keys, true);
      paint();
      if (preset) { code = preset; paint(); go(); }
      this.ui.navigate('netjoin', [...el.querySelectorAll('.btn')], {
        grid: 3,
        onOk: (i, b) => {
          if (b.dataset.d) return press(b.dataset.d);
          if (b.dataset.a === 'back') return cancel();
          leave(); this.ui.hide('netjoin'); this.netLeave(false); this._netQRJoin(n);
        },
        onBack: () => (code.length && !busy ? press('del') : cancel()),
      });
    },

    // UNIRSE CON QR: read the host's code, then show our own for it to read
    async _netQRJoin(n = 2) {
      const net = this._netNew('guest');
      const el = this.ui.show('netqr', `<div class="panel fade-in net-panel qr-panel"><div class="head">UNIRSE CON QR</div>
        <div class="qrwrap">
          <div class="qrcol" data-k="cam"><div class="qrstep"><b>1</b> Enfoca el QR del móvil que crea la partida<br><small>CREAR CON QR</small></div><div class="camview"><video playsinline muted></video><i class="frame"></i></div></div>
          <div class="qrcol" data-k="mine" style="display:none"><div class="qrstep"><b>2</b> Ahora ese móvil escanea este QR</div><div class="qrbox" data-k="qr"></div></div>
        </div>
        <div class="nethelp" data-k="msg"></div>
        <div class="menu row-menu" style="padding-top:2px"><div class="btn" data-a="back">CANCELAR</div></div></div>`);
      const msg = el.querySelector('[data-k=msg]');
      const scanner = new QRScanner(el.querySelector('video'));
      net.scanner = scanner;
      const cancel = () => { scanner.stop(); this.ui.hide('netqr'); this.netLeave(false); this.toNetMenu(n); };
      this.ui.navigate('netqr', [el.querySelector('.btn')], { onOk: cancel, onBack: cancel });
      let reading = false;
      scanner.onresult = async (t) => {
        if (reading) return;
        reading = true;
        try {
          const ans = await net.joinQR(t);
          if (this.net !== net) return;
          scanner.stop();
          el.querySelector('[data-k=cam]').style.display = 'none';
          el.querySelector('[data-k=mine]').style.display = '';
          const box = el.querySelector('[data-k=qr]');
          box.innerHTML = '';
          box.appendChild(qrCanvas(ans, 300));
          box.dataset.text = ans;
          msg.innerHTML = '<i class="spin"></i>Esperando a que el otro móvil lo lea…';
          this.ui.fit(el);
          await net.waitOpen(180000, 'nolink');
          if (this.net !== net) return;
          this.ui.hide('netqr');
          this._netConnected();
        } catch (e) {
          if (this.net !== net) return;
          msg.textContent = netError(e);
          if ((e.message || '').startsWith('version') || e.message === 'notours') { reading = false; this.audio.ui('deny'); }
        }
      };
      try { await scanner.start(); } catch (e) { if (this.net === net) msg.textContent = netError(e); }
    },

    // a guest is in: wait for player 1 to start
    _netConnected() {
      this._wake(true);
      this.audio.ui('ok');
      this.ui.toast('¡Conectado!', 'money', 1500);
      this._netWait('¡CONECTADO!', `Eres el <b>JUGADOR ${this.net.local + 1}</b>. Esperando a que el jugador 1 empiece…`);
    },
    // a waiting panel (another phone is choosing); SALIR leaves the game
    _netWait(title, text) {
      this.ui.hideAll();
      const el = this.ui.show('netwait', `<div class="panel fade-in net-panel"><div class="head">${title}</div>
        <div class="netstatus"><i class="spin"></i>${text}</div>
        <div class="menu row-menu" style="padding-top:2px"><div class="btn" data-a="quit">SALIR DE LA PARTIDA</div></div></div>`);
      this.ui.navigate('netwait', [el.querySelector('.btn')], { onOk: () => this._netQuit(), onBack: () => this._netQuit() });
    },
    // guest: what the host is doing in the lobby
    _netLobby(m) {
      if (m.p === 'room') this._netWait('¡CONECTADO!', `Eres el <b>JUGADOR ${this.net.local + 1}</b>. Alguien se ha ido: esperando a que el jugador 1 vuelva a empezar…`);
      else if (m.p === 'diff') this._netWait('PREPARANDO LA PARTIDA', 'El jugador 1 está eligiendo la dificultad…');
      else if (m.p === 'picking') this._netWait('PREPARANDO LA PARTIDA', `El jugador ${m.player + 1} está eligiendo su vehículo…`);
      else if (m.p === 'select') {
        this.ui.hideAll();
        this.toSelect(1, m.diff, {
          taken: m.taken, title: `JUGADOR ${this.net.local + 1}: ELIGE TU VEHÍCULO`,
          done: (pick) => { this.net.send({ t: 'pick', truckId: pick.truckId, vehicle: pick.vehicle, livery: this._livery(0) }); this._netWait('¡LISTO!', 'Empieza el campeonato…'); },
          back: () => this._netQuit(),
        });
      }
    },
    // host: player 1 has chosen; now each of the others, in turn, on their phones
    _netHostPicked(pick, diff) {
      this._netPicks = [pick]; this._netDiff = diff;
      this._netNextPick();
    },
    // the players in order with no gaps (2, 3), so seat = championship player
    _netSeats() {
      const net = this.net;
      net.guests.forEach((peer, i) => {
        if (peer.player === i + 1) return;
        for (const [k, v] of Object.entries(net.seats)) if (v === peer.player) net.seats[k] = i + 1;
        peer.player = i + 1;
        peer.send({ t: 'seat', player: i + 1 });
      });
    },
    _netNextPick() {
      const net = this.net, picks = this._netPicks;
      const players = [0, ...net.guests.map((p) => p.player)];
      if (picks.length >= players.length) { this._netSeats(); this.startChampionship(picks, this._netDiff); return; }
      const p = players[picks.length];
      net.sendTo(p, { t: 'lobby', p: 'select', diff: this._netDiff, taken: picks });
      net.send({ t: 'lobby', p: 'picking', player: p }, [p]);
      this._netWait('PREPARANDO LA PARTIDA', `El jugador ${p + 1} está eligiendo su vehículo…`);
    },
    _netGuestPick(m, from) {
      const picks = this._netPicks;
      if (!picks || from !== picks.length || this.net.started) return;
      const truckId = typeof m.truckId === 'string' ? m.truckId : '';
      if (picks.some((q) => q.truckId === truckId) || !['red', 'blue', 'yellow'].includes(truckId)) { this._netNextPick(); return; } // taken meanwhile: again
      picks.push({ truckId, vehicle: m.vehicle === 'buggy' ? 'buggy' : 'truck', livery: m.livery });
      this._netNextPick();
    },

    // ---------------------------------------------------------------- leaving
    // leave the game (bye: tell the other phones)
    netLeave(bye = true) {
      const net = this.net;
      if (!net) return;
      this.net = null;
      if (net.scanner) net.scanner.stop();
      if (bye) net.bye(); else net.close();
      this._wake(false);
      this.ui.hide('netlost');
    },
    _netQuit() { this._fade(() => { this.netLeave(true); this.toTitle(); }); },

    // another phone said goodbye: on a guest, the host (the game is over); on the host,
    // a player (the others play on)
    _netGone(from) {
      const net = this.net;
      if (net.role === 'guest') {
        this.netLeave(false);
        this._fade(() => { this.toTitle(); this.ui.toast('El jugador 1 ha terminado la partida', 'small warn', 2600); });
        return;
      }
      if (!net.started) { this._netLobbyGone(from); return; }
      this._netWithout(from, `El jugador ${from + 1} ha salido<br><span class="sub">Su camión sigue para la CPU</span>`);
    },
    // a guest's link went down (or, on a guest, the link to the host)
    _netLost(from) {
      const net = this.net;
      if (net.role === 'guest') {
        if (net.mode === 'code') { this._netRetry(); return; }
        this._netLostPanel('SE HA PERDIDO LA CONEXIÓN', 'Sin internet no se puede volver a la partida: salid y conectad otra vez con los QR.', null);
        return;
      }
      if (!net.started) { this._netLobbyGone(from); return; }
      this._netLostPanel(`SE HA PERDIDO EL JUGADOR ${from + 1}`,
        net.mode === 'code' && net.sig ? `Si vuelve a <b>UNIRSE</b> con el código <b class="gold">${net.code}</b>, seguís donde estabais.` : 'Sin internet no puede volver a entrar en esta partida.', from);
    },
    // in the lobby, before the start: one fewer in the room
    _netLobbyGone(p) {
      const net = this.net;
      net.drop(p);
      this.ui.toast(`El jugador ${p + 1} se ha ido`, 'small warn', 2000);
      if (net.lobby && net.lobby.el.isConnected) { this._netPlayers(); if (net.lobby.qr) this._netNextQR(); return; }
      // choosing already: back to the room with the same code (the one who left can come back)
      this._netBackToRoom();
    },
    _netLostPanel(title, text, player) {
      const host = this.net && this.net.role === 'host';
      if ((this.state === 'race' || this.state === 'intro') && !this.paused) this.pause(!host);
      this.ui.hide('netwait');
      const el = this.ui.show('netlost', `<div class="panel fade-in net-panel"><div class="head">${title}</div>
        <div class="nethelp">${text}</div>${host ? '<div class="netstatus"><i class="spin"></i>Esperando…</div>' : ''}
        <div class="menu row-menu" style="padding-top:2px">${host ? '<div class="btn primary" data-a="solo">SEGUIR SIN ÉL</div>' : ''}<div class="btn" data-a="quit">SALIR</div></div></div>`);
      this.ui.navigate('netlost', [...el.querySelectorAll('.btn')], {
        axis: 'h',
        onOk: (i, b) => {
          if (b.dataset.a !== 'solo') return this._netQuit();
          this.ui.hide('netlost');
          this._netWithout(player, '');
        },
      });
    },
    // host: on without that player; their truck is the CPU's from now on. With nobody
    // left the championship is player 1's alone (and saved again like any other)
    _netWithout(p, toast) {
      const net = this.net;
      net.drop(p);
      if (this.session && this.session.players[p]) this.session.eliminate(p);
      if (this.race && !this.race.shadow) for (const r of this.race.racers) if (r.remote && r.entry.player === p) r.bot = true;
      for (const k of Object.keys(net.ready)) if (net.ready[k]) net.ready[k].delete(p);
      if (toast) this.ui.toast(toast, 'small warn', 2600);
      if (net.guests.length) {
        net.send({ t: 'left', player: p });
        for (const k of Object.keys(net.ready)) this._netCheck(k);
        return;
      }
      // the last guest gone: an ordinary championship from here
      this.netLeave(false);
      if (this.session) this.session.net = false;
      this.ui.hide('netwait');
      if (this.state === 'results' && this._resultsAgain) this._resultsAgain();
      else if (this.state === 'shop') this.toShop(0);
      else if (this.state === 'podium' && !this.ui.get('podium')) this.toShop(0);
    },
    // seconds without a word from a phone (in the background, WiFi trouble)
    _netStall(p, on) {
      const racing = this.state === 'race' || this.state === 'intro';
      if (on) {
        const note = this.net.role === 'host' ? `La conexión con el jugador ${p + 1} se ha cortado un momento: esperando…` : 'La conexión se ha cortado un momento: esperando al jugador 1…';
        if (racing && !this.paused) { this.pause(this.net.role === 'guest', note); this._stallPause = true; }
        else if (!this.ui.get('netlost')) this.ui.toast(`Esperando ${this.net.role === 'host' ? `al jugador ${p + 1}` : 'al jugador 1'}…`, 'small warn', 3000);
      } else if (!this.net.stalled) {
        // back: a pause that came from the silence goes away by itself
        if (this._stallPause && this.paused) this.resume(this.net.role === 'guest');
        this._stallPause = false;
        this.ui.toast('Conexión recuperada', 'small', 1400);
      }
    },
    // guest: knock on the same room again for a while
    async _netRetry() {
      const net = this.net;
      if ((this.state === 'race' || this.state === 'intro') && !this.paused) this.pause(true);
      const el = this.ui.show('netlost', `<div class="panel fade-in net-panel"><div class="head">RECONECTANDO…</div>
        <div class="netstatus"><i class="spin"></i>Volviendo a la partida ${net.code}…</div>
        <div class="menu row-menu" style="padding-top:2px"><div class="btn" data-a="quit">SALIR</div></div></div>`);
      this.ui.navigate('netlost', [el.querySelector('.btn')], { onOk: () => this._netQuit(), onBack: () => this._netQuit() });
      for (let i = 0; i < 15 && this.net === net && !net.open; i++) {
        try { await net.joinCode(net.code); } catch (e) { if (e.message === 'busy' || e.message === 'full') break; await sleep(3000); }
      }
      if (this.net !== net) return;
      if (net.open) { this.ui.hide('netlost'); this.ui.toast('¡Reconectado!', 'money', 1500); return; }
      el.querySelector('.netstatus').textContent = 'No se ha podido volver a la partida.';
    },
    // host: a guest is back: everything it needs to rebuild its screen
    _netRejoined(p) {
      const net = this.net;
      this.ui.hide('netlost');
      this.ui.toast(`¡El jugador ${p + 1} ha vuelto!`, 'money', 1800);
      if (net.raceMsg) net.sendTo(p, { ...net.raceMsg, resume: true });
      if (net.phaseMsg) net.sendTo(p, { ...net.phaseMsg, now: true });
      if (this.paused) net.sendTo(p, { t: 'pause' });
    },

    // ---------------------------------------------------------------- race (guest)
    _guestRace(m) {
      const net = this.net;
      net.raceMsg = m; net.phaseMsg = null;
      net.send({ t: 'loading' });
      this.ui.hideAll();
      this.hud.destroy();
      this.paused = false;
      this.audio.pause(false);
      this.attract = false; this.attractTick = null; this.stateTick = null; this.freeSetup = null;
      this.view.setActive(null, null);
      this.session = this._mirror(m.sess);
      const track = this.world.loadTrack(m.id, m.reverse, m.time, !!m.rain);
      this.audio.setRain(!!m.rain);
      // the other players' trucks are rivals here; this phone drives only its own
      const entries = m.entries.map((e) => (e.human && e.player !== net.local ? { ...e, human: false, remote: true } : { ...e, remote: false }));
      this.input.solo = true;
      for (let p = 0; p < 3; p++) this.input.autoGas[p] = !!this.opt.autoGas && p === 0;
      this.race = new Race(track, entries, { laps: m.laps, pickups: false, rain: !!m.rain, seed: 1 });
      this.race.shadow = true;
      for (const r of this.race.racers) if (r.entry.remote) r.remote = true;
      this.assists = []; this.assistUsed = 0; this.replayRec = null; this.trial = null; this.tutorial = null; this.lapRecordSet = false;
      this.world.setRace(this.race);
      this.world.setGhosts([]);
      this._applyGuide();
      const me = this.race.racers.find(mine);
      this.raceLog = me ? { me, nitro: 0, walls: 0, lastInFinal: false } : null;
      // our own truck, simulated here too so it answers the finger at once
      if (me) {
        const t = new TruckSim(me.i, { ...me.truck.stats });
        t.place(me.truck.x, me.truck.z, me.truck.h, track);
        t.frozen = true;
        this._pred = { t, assist: new SteerAssist(t, track, ASSIST_LEVELS[this.opt.assist] || 0), hist: [], acc: 0, last: -1, ready: false, off: { x: 0, y: 0, z: 0, h: 0 }, q: {} };
      } else this._pred = null;
      this.acc = DT;
      this.audio.startRace(this.race);
      this.hud.trial = null;
      this.hud.build(this.race, this.session);
      this._netHUD();
      this.world.refit();
      net.resetStream();
      this._sendLoaded = 3; // after its first frames are drawn (the shaders of a new circuit take a while)
      this.touch.root.classList.remove('intro');
      this.touch.show(!!me); // without credits: watching, nothing to drive
      if (m.resume || m.skipIntro) { this.state = 'race'; this.introT = null; this._raceCamera(true); this.audio.music('race'); return; }
      this._intro(m.id, m.reverse, { rain: m.rain }, false, '');
    },

    // guest, every frame: the race a moment ago, what happened in it, our controls, and
    // our own truck now (predicted)
    _guestFrame(dt) {
      const net = this.net, race = this.race;
      if (!net || !race) return;
      const me = race.racers.find(mine), P = this._pred;
      // ours is predicted while we drive it (after the line the host's autopilot has it)
      const pred = !!(P && me && P.ready && !me.finished && race.state !== 'done');
      const rt = net.clock.render(performance.now());
      const s = net.around(rt);
      if (s) { applyState(race, s[0], s[1], s[2], pred ? me.i : -1); net.trim(rt); }
      this.acc = DT; // the world draws this state as it is
      while (net.evq.length && net.evq[0].ht <= rt) this._netEvents(net.evq.shift().e);
      this._raceTick(race);
      if (this.state !== 'race' && this.state !== 'intro') return;
      const inp = this.input.get(0);
      let steer = inp.steer;
      if (inp.targetHeading != null && me) {
        let d = inp.targetHeading - me.truck.h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        steer = Math.max(-1, Math.min(1, d * 2.4));
      }
      const raw = { steer: me ? steer : 0, throttle: me ? inp.throttle : 0, brake: me ? inp.brake : 0, nitro: !!(me && inp.nitro) };
      net.sendInput(raw.steer, raw.throttle, raw.brake, raw.nitro);
      this.input.consumeNitro();
      if (P && me) this._predict(dt, raw, net.iseq, net.last, me);
    },

    // Client-side prediction: our truck is simulated here with our own controls (the
    // same steering assist and rounding the host applies), so it answers at once. Each
    // new snapshot says where it really was after the controls the host had used: from
    // there the ones it had not used yet are run again, and the jump between the two
    // predictions is spread over a tenth of a second instead of seen.
    _predict(dt, raw, seq, newest, me) {
      const P = this._pred, race = this.race;
      if (newest && newest.seq !== P.last && newest.racers[me.i]) {
        P.last = newest.seq;
        const t = P.t, old = { x: t.x, y: t.y, z: t.z, h: t.h };
        const A = newest.racers[me.i];
        writeTruck(t, A, A, 0);
        P.hist = P.hist.filter((h) => h.seq > newest.ack);
        for (const h of P.hist) for (let k = 0; k < h.steps; k++) this._predStep(h.inp);
        if (P.ready) {
          const dx = old.x - t.x, dz = old.z - t.z;
          if (dx * dx + dz * dz < 36) { P.off.x += dx; P.off.y += old.y - t.y; P.off.z += dz; P.off.h += wrapAngle(old.h - t.h); }
          else P.off.x = P.off.y = P.off.z = P.off.h = 0; // too far (a big knock): straight there
        }
        P.ready = true;
      }
      if (!P.ready) return;
      // this frame's controls, step by step like the host's simulation
      P.acc += dt;
      let steps = 0;
      while (P.acc >= DT && steps < 12) { this._predStep(raw); P.acc -= DT; steps++; }
      if (steps >= 12) P.acc = 0;
      P.hist.push({ seq, inp: raw, steps });
      if (P.hist.length > 150) P.hist.shift();
      if (me.finished || race.state === 'done') return;
      // drawn: the prediction plus what is left of the last correction
      const k = Math.exp(-dt / 0.1), o = P.off, t = P.t, d = me.truck;
      o.x *= k; o.y *= k; o.z *= k; o.h *= k;
      for (const f of ['vx', 'vz', 'vy', 'w', 'air', 'airTime', 'hAbove', 'traction', 'steer', 'throttle', 'slip', 'water', 'nitroT', 'nitros', 'landImpact', 'frozen', 'vf', 'speed']) d[f] = t[f];
      d.x = t.x + o.x; d.y = t.y + o.y; d.z = t.z + o.z; d.h = wrapAngle(t.h + o.h);
    },
    _predStep(raw) {
      const P = this._pred, race = this.race;
      quantize(P.assist.level && race.state === 'race' ? P.assist.apply(DT, raw) : raw, P.q);
      P.t.step(DT, P.q, race.track);
    },

    // guest: the host's race events, as the host's own frame handles them
    _netEvents(evs) {
      const race = this.race;
      if (!race || !race.shadow) return;
      this.world.handleEvents(evs);
      this.audio.handle(evs, race);
      this.haptics.handle(evs, race);
      if (this.state !== 'race') return;
      this.hud.handle(evs);
      for (const ev of evs) {
        if ((ev[0] === 'lap' || ev[0] === 'finish') && ev[3]) this._lapDone(ev);
        this._callout(ev);
        if (this.raceLog && ev[1] === this.raceLog.me.i) this._logEvent(ev);
      }
    },

    // guest: the race has ended on the host: the same results here
    _guestDone(m) {
      const net = this.net;
      net.phaseMsg = m;
      if (!this.race || !this.race.shadow) return;
      this.session = this._mirror(m.sess);
      this.state = 'post';
      const S = m.summary, me = this.session.players[net.local];
      const row = S.rows.find((r) => r.human && r.player === net.local), L = this.raceLog;
      // the career counts each race once (a phone coming back gets the results again)
      if (L && row && this._doneRace !== S.raceNo) {
        this._doneRace = S.raceNo;
        this.career.race({
          place: row.place, finished: !!row.time, humans: S.rows.filter((r) => r.human).length, difficulty: this.session.difficulty, vehicle: L.me.entry.vehicle,
          night: this.world.timeName === 'night', nitro: L.nitro, walls: L.walls, bags: L.me.money, lastInFinal: L.lastInFinal,
          track: this.race.track.id, km: L.me.prog / 1000, streak: me ? me.streak || 0 : 0, free: false,
        });
        if (me) this.career.score(me.earned);
      }
      const w = S.rows[0], wi = this.race.racers.findIndex((r) => r.entry.truckId === w.truckId);
      this.world.setCamera('tv', { index: Math.max(0, wi) });
      this.audio.announce(w.human && w.player === net.local ? 'winner' : 'race_over');
      if (m.now) this.showResults(S);
      else { this.fireworksT = 4; this.stateTick = this._delay(2.2, () => this.showResults(S)); }
    },

    // the connection's quality in a corner of the race screen
    _netHUD() {
      if (!this.net || !this.hud.el) return;
      this._pingEl = h('<div class="netping"><i></i><span></span></div>');
      this.hud.el.appendChild(this._pingEl);
      this._pingT = 0;
    },
    _netPingTick(dt) {
      const el = this._pingEl;
      if (!el || !this.net || !el.isConnected) return;
      if ((this._pingT -= dt) > 0) return;
      this._pingT = 0.5;
      const r = Math.round(this.net.rtt || 0), bad = this.net.stalled;
      el.querySelector('span').textContent = bad ? '…' : `${r} ms`;
      el.className = `netping ${bad || r > 160 ? 'bad' : r > 70 ? 'meh' : 'good'}`;
    },

    // ---------------------------------------------------------------- championship
    // every phone presses CONTINUAR before going on; the host decides what comes next
    _netReady(k, btn) {
      if (!this.net) return;
      if (btn) { btn.classList.add('disabled', 'waiting'); btn.innerHTML = '<i class="spin"></i>ESPERANDO A LOS DEMÁS'; }
      else this._netWait('UN MOMENTO', 'Esperando a los demás jugadores…');
      this._netReadySend(k);
    },
    _netReadySend(k) {
      const net = this.net;
      if (!net) return;
      if (net.role === 'guest') { net.send({ t: 'ready', k }); return; }
      this._netReadyFrom(k, 0);
    },
    _netReadyFrom(k, p) {
      const net = this.net;
      (net.ready[k] = net.ready[k] || new Set()).add(p);
      this._netCheck(k);
    },
    _netCheck(k) {
      const net = this.net;
      const set = net && net.ready[k];
      if (!set || ![0, ...net.guests.map((g) => g.player)].every((p) => set.has(p))) return;
      net.ready[k] = null;
      this.ui.hide('netwait');
      if (k === 'results') {
        const S = this.lastSummary;
        for (const p of S.players) if (p.credits <= 0) this.session.eliminate(p.index);
        if (this.session.over) { this._fade(() => this.toGameOver()); return; }
        if (S.cup && S.cup.done && !S.cup.shown) {
          S.cup.shown = true;
          const msg = { t: 'podium', cup: S.cup, sess: this.session.snapshot() };
          net.send(msg); net.phaseMsg = msg;
          this._fade(() => this.toPodium(S.cup, () => this._netReady('podium')));
          return;
        }
        this._netShop();
      } else if (k === 'podium') this._netShop();
      else if (k === 'shop') this._fade(() => { this.ui.hideAll(); this.view.setActive(null, null); this.stateTick = null; this.nextRace(); });
    },
    // host: every phone to its shop
    _netShop() {
      const net = this.net;
      const msg = { t: 'shop', sess: this.session.snapshot() };
      net.send(msg); net.phaseMsg = msg;
      net.ready.shop = null;
      this._fade(() => { this.ui.hideAll(); this.toShop(0); });
    },
    // host: a guest buys in its shop
    _netBuy(m, from) {
      const p = this.session.players[from];
      if (!p || !p.alive) return;
      let ok = false;
      if (m.key === 'nitro1') ok = this.session.buyNitro(p, 1) > 0;
      else if (m.key === 'nitro5') ok = this.session.buyNitro(p, 5) > 0;
      else if (m.key === 'credit') ok = this.session.convertCredit(p);
      else if (['tires', 'shocks', 'accel', 'speed'].includes(m.key)) ok = this.session.buyUpgrade(p, m.key);
      this.net.sendTo(from, { t: 'sess', sess: this.session.snapshot(), ok, key: m.key });
    },
    _netPaint(m, from) {
      const p = this.session.players[from];
      if (p && typeof m.livery === 'string') p.livery = m.livery;
      this.net.sendTo(from, { t: 'sess', sess: this.session.snapshot() });
    },
    // guest: the championship after a purchase
    _netSess(m) {
      this.session = this._mirror(m.sess);
      if (m.key && m.ok) this.audio.sfx('cash');
      else if (m.key) this.audio.ui('deny');
      if (this.state === 'shop' && this._shopRender && this.ui.get('shop')) this._shopRender(this._shopFocus || 0);
    },

    // keep the screen on while phones play together (a sleeping phone drops the game)
    async _wake(on) {
      try {
        if (on && !this._wl && navigator.wakeLock && !document.hidden) {
          const wl = await navigator.wakeLock.request('screen');
          this._wl = wl;
          wl.addEventListener('release', () => { if (this._wl === wl) this._wl = null; });
        } else if (!on && this._wl) { const wl = this._wl; this._wl = null; await wl.release(); }
      } catch (e) { /* not allowed right now */ }
    },
  });
}
