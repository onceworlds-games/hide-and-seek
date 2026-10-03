// DOM screens: the title (one button), the workshop hub (the lobby: a route card, the parts and
// paint drawers, the legs), results, the room-closed card, the signal wheel and the "join at
// checkpoint" offer. Labels, not sentences. Every string from another player goes through textContent.
import * as C from '../sim/constants.js';
import { BIOMES, MUTATORS, MUTATOR_IDS, expeditionId, expeditionInfo } from '../sim/courses.js';
import { PAINTS, STICKERS, HATS, HORNS, unlockedCount } from '../sim/save.js';
import { fmtTime } from '../sim/score.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (label, cls, onClick) => {
  const b = el('button', `btn ${cls ?? ''}`, label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick?.(e);
  });
  return b;
};
const MEDAL_WORD = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };
const CARGO_WORD = (id) => C.CARGO[id]?.name ?? 'Cargo';

export function createScreens(root, app) {
  let current = null;
  let currentName = '';
  let drawer = ''; // which workshop drawer is open: '', 'parts', 'paint', 'mutators'
  let lastModel = null;
  const show = (name, node) => {
    root.replaceChildren(node);
    current = node;
    currentName = name;
  };
  const clear = () => {
    root.replaceChildren();
    current = null;
    currentName = '';
  };

  // The host browses expeditions with the arrow keys while the workshop is up.
  window.addEventListener('keydown', (e) => {
    if (currentName !== 'workshop' || !lastModel?.isHost || lastModel.setup.mode !== 'expedition') return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      step(lastModel, e.code === 'ArrowLeft' ? -1 : 1);
    } else if (e.code === 'Escape' && drawer) {
      drawer = '';
      workshop(lastModel);
    }
  });

  function title() {
    const s = el('div', 'screen title');
    s.appendChild(el('h1', 'title-word', 'LEGWORK'));
    const play = btn('PLAY', 'big play', () => app.play());
    s.appendChild(play);
    show('title', s);
    play.focus();
  }

  /** The open expeditions in order, as [biome, index]. */
  const openList = (save) => {
    const n = unlockedCount(save);
    const out = [];
    for (let k = 0; k < n; k++) out.push([Math.floor(k / 4), k % 4]);
    return out;
  };
  function step(m, dir) {
    const list = openList(m.save);
    const k = list.findIndex(([b, i]) => b === m.setup.biome && i === m.setup.index);
    const next = list[(Math.max(0, k) + dir + list.length) % list.length];
    if (next) app.setSetup({ ...m.setup, biome: next[0], index: next[1], ghost: false });
  }

  /** The route card: what the next run is. */
  function routeCard(m) {
    const card = el('div', 'route');
    const top = el('div', 'route-top');
    const mode = m.setup.mode;
    top.appendChild(el('span', 'route-biome', mode === 'expedition' ? BIOMES[m.setup.biome].name : mode === 'daily' ? `Daily · ${BIOMES[m.daily.biome].name}` : 'Endless'));
    top.appendChild(el('span', 'route-scrap', `${m.save.scrap} SCRAP`));
    card.appendChild(top);
    const main = el('div', 'route-main');
    const canPick = m.isHost && mode === 'expedition' && openList(m.save).length > 1;
    if (canPick) main.appendChild(btn('◀', 'arrow', () => step(m, -1)));
    const mid = el('div', 'route-mid');
    if (mode === 'expedition') {
      const info = expeditionInfo(m.setup.biome, m.setup.index);
      mid.appendChild(el('div', 'route-name', info.name));
      const medal = m.save.medals[info.id];
      const best = m.save.best[info.id];
      const meta = [CARGO_WORD(info.cargo), `${info.length} m`];
      if (info.budget !== C.TUMBLE_BUDGET) meta.push(`${info.budget} tumbles`);
      // one line: cargo, length, and the medal and best time once there are some
      const line = el('div', 'route-meta');
      line.appendChild(el('span', '', meta.join(' · ')));
      if (medal) line.appendChild(el('span', `medal-dot ${medal}`, MEDAL_WORD[medal]));
      if (best) line.appendChild(el('span', 'route-best', fmtTime(best)));
      mid.appendChild(line);
    } else if (mode === 'daily') {
      mid.appendChild(el('div', 'route-name', 'Daily Stride'));
      mid.appendChild(el('div', 'route-meta', `${MUTATORS[m.daily.mutators[0]]?.name ?? ''} · Day ${m.daily.day}`));
    } else {
      mid.appendChild(el('div', 'route-name', 'Endless Stride'));
      mid.appendChild(el('div', 'route-meta', m.save.endlessBest ? `Best ${m.save.endlessBest} m` : 'As far as it goes'));
    }
    main.appendChild(mid);
    if (canPick) main.appendChild(btn('▶', 'arrow', () => step(m, 1)));
    card.appendChild(main);
    if (mode === 'expedition') {
      // the biome's four expeditions as stamps: number, medal colour, the current one raised
      const stamps = el('div', 'stamps');
      const open = unlockedCount(m.save);
      for (let i = 0; i < 4; i++) {
        const id = expeditionId(m.setup.biome, i);
        const isOpen = open > m.setup.biome * 4 + i;
        const medal = m.save.medals[id];
        const s = el('button', `stamp ${m.setup.index === i ? 'on' : ''} ${isOpen ? '' : 'locked'} ${medal ?? ''}`, String(i + 1));
        s.type = 'button';
        s.title = expeditionInfo(m.setup.biome, i).name;
        s.disabled = !m.isHost || !isOpen;
        s.addEventListener('click', () => app.setSetup({ ...m.setup, index: i, ghost: false }));
        stamps.appendChild(s);
      }
      const hasGhost = !!m.save.ghosts[expeditionId(m.setup.biome, m.setup.index)];
      if (hasGhost) {
        const g = el('button', `stamp ghost ${m.setup.ghost ? 'on' : ''}`, 'GHOST');
        g.type = 'button';
        g.disabled = !m.isHost;
        g.addEventListener('click', () => app.setSetup({ ...m.setup, ghost: !m.setup.ghost }));
        stamps.appendChild(g);
      }
      card.appendChild(stamps);
    }
    if (!m.isHost) card.appendChild(el('div', 'route-host', `${m.hostName || 'Host'} picks`));
    return card;
  }

  function modes(m) {
    const row = el('div', 'modes');
    for (const [id, label] of [['expedition', 'Expedition'], ['endless', 'Endless'], ['daily', 'Daily']]) {
      const c = el('button', `mode ${m.setup.mode === id ? 'on' : ''}`, label);
      c.type = 'button';
      c.disabled = !m.isHost;
      c.addEventListener('click', () => app.setSetup({ ...m.setup, mode: id }));
      row.appendChild(c);
    }
    return row;
  }

  function seatsRow(m) {
    const row = el('div', 'seats');
    for (let i = 0; i < 4; i++) {
      const id = m.seats[i];
      const pl = id ? m.players.get(id) : null;
      const seat = el('button', `seat ${id === m.me ? 'mine' : ''}`);
      seat.type = 'button';
      const sw = el('span', 'swatch');
      sw.style.background = C.LEG_COLORS[i];
      seat.appendChild(sw);
      if (pl) {
        const img = el('img');
        img.alt = '';
        img.crossOrigin = 'anonymous';
        app.avatar(pl.id).then((url) => {
          if (url) img.src = url;
          else img.remove();
        });
        seat.appendChild(img);
        seat.appendChild(el('span', 'name', pl.name || 'Player'));
        if (id === m.host) seat.appendChild(el('span', 'tag', 'HOST'));
        else if (pl.ready) seat.appendChild(el('span', 'tag ok', 'READY'));
      } else seat.appendChild(el('span', 'name', 'Bot'));
      seat.title = C.LEG_NAMES[i];
      seat.addEventListener('click', () => {
        if (!id) app.claimSeat(i);
      });
      row.appendChild(seat);
    }
    return row;
  }

  function drawerNode(m) {
    const d = el('div', 'drawer');
    const head = el('div', 'drawer-head');
    head.appendChild(el('h3', '', drawer === 'parts' ? 'PARTS' : drawer === 'paint' ? 'PAINT SHOP' : 'MUTATORS'));
    head.appendChild(btn('CLOSE', 'small cream', () => {
      drawer = '';
      workshop(m);
    }));
    d.appendChild(head);
    const body = el('div', 'drawer-body');
    const row = (label, chips) => {
      body.appendChild(el('div', 'drawer-label', label));
      const r = el('div', 'chips');
      for (const c of chips) r.appendChild(c);
      body.appendChild(r);
    };
    const chip = (label, on, cost, disabled, onClick, swatch) => {
      const c = el('button', `chip ${on ? 'on' : ''}`, label);
      c.type = 'button';
      if (swatch) {
        const sw = el('span', 'chip-swatch');
        sw.style.background = swatch;
        c.prepend(sw);
      }
      if (cost) c.appendChild(el('span', 'cost', String(cost)));
      c.disabled = disabled;
      c.addEventListener('click', onClick);
      return c;
    };
    const s = m.save;
    if (drawer === 'parts') {
      row('Feet', Object.entries(C.FEET).map(([id, f]) => chip(f.name, s.feet === id, s.feetOwned.includes(id) ? 0 : f.cost, !s.feetOwned.includes(id) && s.scrap < f.cost, () => app.buyFeet(id))));
      const level = (label, levels, value, key) => row(label, levels.map((lv, i) => chip(lv.name, value === i, i > value ? lv.cost : 0, i > value + 1 || (i > value && s.scrap < lv.cost), () => app.buyLevel(key, i))));
      level('Hips', C.HIPS_LEVELS, s.hips, 'hips');
      row('Chassis', Object.entries(C.CHASSIS).map(([id, ch]) => chip(ch.name, s.chassis === id, s.chassisOwned.includes(id) ? 0 : ch.cost, !s.chassisOwned.includes(id) && s.scrap < ch.cost, () => app.buyChassis(id))));
      level('Cradle', C.CRADLE_LEVELS, s.cradle, 'cradle');
      level('Mechanic', C.MECHANIC_LEVELS, s.mechanic, 'mechanic');
    } else if (drawer === 'paint') {
      const cos = (label, list, value, key) => row(label, list.map((item) => chip(item.name, value === item.id, s.cosmetics.includes(item.id) ? 0 : item.cost, !s.cosmetics.includes(item.id) && s.scrap < item.cost, () => app.buyCosmetic(key, item.id), item.color)));
      cos('Paint', PAINTS, s.paint, 'paint');
      cos('Sticker', STICKERS, s.sticker, 'sticker');
      cos('Cargo hat', HATS, s.hat, 'hat');
      cos('Horn', HORNS, s.horn, 'horn');
    } else {
      row(m.isHost ? 'Change the rules' : `${m.hostName || 'Host'} picks`, MUTATOR_IDS.map((id) => {
        const on = m.setup.mutators.includes(id);
        return chip(MUTATORS[id].name, on, 0, !m.isHost, () => app.setSetup({ ...m.setup, mutators: on ? m.setup.mutators.filter((x) => x !== id) : [...m.setup.mutators, id] }));
      }));
    }
    d.appendChild(body);
    return d;
  }

  /** The workshop: the lobby. `m` is the model built by the app each refresh. */
  function workshop(m) {
    lastModel = m;
    const s = el('div', `screen hub ${drawer ? 'drawer-open' : ''}`);
    const panel = el('div', 'hub-panel');
    panel.appendChild(modes(m));
    panel.appendChild(routeCard(m));
    // the drawers: parts, paint and (once the first biome is done, or when the host set some) mutators
    const tools = el('div', 'tools');
    const toolBtn = (id, label) => {
      const b = btn(label, `tool ${drawer === id ? 'on' : ''}`, () => {
        drawer = drawer === id ? '' : id;
        workshop(m);
      });
      tools.appendChild(b);
    };
    toolBtn('parts', 'PARTS');
    toolBtn('paint', 'PAINT');
    const mutators = m.setup.mode !== 'daily' && (unlockedCount(m.save) > 4 || m.setup.mutators.length > 0);
    if (mutators) toolBtn('mutators', m.setup.mutators.length ? `RULES ${m.setup.mutators.length}` : 'RULES');
    if (m.players.size < 4 && !m.standalone) tools.appendChild(btn('INVITE', 'tool invite', () => app.invite()));
    panel.appendChild(tools);
    if (m.players.size > 1) panel.appendChild(seatsRow(m));
    if (m.standalone && m.isHost) {
      const start = btn('START', 'big teal start', () => app.start());
      start.id = 'start';
      start.disabled = !m.canStart;
      panel.appendChild(start);
    }
    // the last run's receipt, under what comes next
    if (m.results) panel.appendChild(resultsCard(m.results, m, true));
    s.appendChild(panel);
    if (drawer === 'mutators' && !mutators) drawer = '';
    if (drawer) s.appendChild(drawerNode(m));
    show('workshop', s);
  }

  /** The run's receipt: what it was made of, the medal, the scrap; the next expedition when there is one. */
  function resultsCard(r, m, inLobby) {
    const card = el('div', `receipt ${inLobby ? 'small' : ''}`);
    const medal = r.finished ? r.medal ?? 'bronze' : 'none';
    const head = el('div', 'receipt-head');
    const stamp = el('div', `medal-stamp ${medal}`);
    stamp.appendChild(el('span', '', r.finished ? (medal === 'none' ? '✓' : MEDAL_WORD[medal][0]) : r.kind === 'endless' ? `${r.distance}` : `${r.progress}%`));
    head.appendChild(stamp);
    const words = el('div', 'receipt-words');
    words.appendChild(el('h2', '', r.finished ? (medal === 'gold' ? 'GOLD STRIDE' : medal === 'silver' ? 'SILVER STRIDE' : 'MADE IT') : r.kind === 'endless' ? `${r.distance} METRES` : r.why === 'tumbles' ? 'OUT OF TUMBLES' : 'RUN OVER'));
    const ids = /^e([1-6])-([1-4])$/.exec(r.courseId ?? '');
    const sub = r.kind === 'expedition' && ids ? expeditionInfo(Number(ids[1]) - 1, Number(ids[2]) - 1).name : r.kind === 'daily' ? 'Daily Stride' : 'Endless Stride';
    words.appendChild(el('div', 'receipt-sub', sub));
    head.appendChild(words);
    card.appendChild(head);
    if (inLobby) {
      // in the hub: one line under the stamp, the details were on the results screen
      words.appendChild(el('div', 'receipt-line', `${fmtTime(r.time)} · ${r.tumbles} ${r.tumbles === 1 ? 'tumble' : 'tumbles'} · cargo ${Math.round(r.cond * 100)}% · +${r.scrap} scrap`));
      if (m?.setup?.mode === 'expedition' && r.kind === 'expedition' && r.finished) {
        const next = expeditionInfo(m.setup.biome, m.setup.index);
        if (next.id !== r.courseId) card.appendChild(el('div', 'receipt-next', `Next: ${next.name}`));
      }
      return card;
    }
    const grid = el('div', 'receipt-stats');
    const stat = (v, label) => {
      const d = el('div', 'rstat');
      d.appendChild(el('b', '', String(v)));
      d.appendChild(el('small', '', label));
      grid.appendChild(d);
    };
    stat(fmtTime(r.time), 'Time');
    stat(r.tumbles, 'Tumbles');
    stat(`${Math.round(r.cond * 100)}%`, 'Cargo');
    stat(r.grooveAvg, 'Groove');
    stat(`+${r.scrap}`, 'Scrap');
    card.appendChild(grid);
    if (r.legNames && r.legNames.some((n) => n !== 'Bot')) {
      const row = el('div', 'receipt-legs');
      r.legNames.forEach((n, i) => {
        const chip = el('span', 'leg-name');
        const sw = el('span', 'swatch');
        sw.style.background = C.LEG_COLORS[i];
        chip.appendChild(sw);
        chip.appendChild(document.createTextNode(n));
        row.appendChild(chip);
      });
      card.appendChild(row);
    }
    const row = el('div', 'receipt-actions');
    if (m.isHost) row.appendChild(btn('WORKSHOP', 'teal', () => app.backToWorkshop()));
    else row.appendChild(el('span', 'waiting', `Waiting for ${m.hostName || 'the host'}`));
    card.appendChild(row);
    return card;
  }

  function results(r, m) {
    const s = el('div', 'screen results');
    s.appendChild(resultsCard(r, m, false));
    show('results', s);
  }

  function closed(reason) {
    const s = el('div', 'screen');
    const card = el('div', 'receipt closed');
    const text = reason === 'kicked' ? 'YOU WERE REMOVED' : reason === 'replaced' ? 'PLAYING IN ANOTHER TAB' : reason === 'disconnected' ? 'CONNECTION LOST' : 'LEFT THE WORKSHOP';
    card.appendChild(el('h2', '', text));
    const label = reason === 'disconnected' ? 'REJOIN' : reason === 'replaced' ? 'PLAY HERE' : 'PLAY';
    card.appendChild(btn(label, 'big', () => app.rejoin()));
    s.appendChild(card);
    show('closed', s);
  }

  function watching(canJoin, requested) {
    const s = el('div', 'overlay-bottom');
    if (canJoin) s.appendChild(btn(requested ? 'JOINING AT CHECKPOINT' : 'JOIN AT CHECKPOINT', requested ? 'cream small' : 'brass', () => app.requestJoin()));
    show('watching', s);
  }

  function wheel(onPick) {
    const w = el('div', 'wheel');
    C.SIGNALS.forEach((label, i) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.appendChild(el('b', '', `${i + 1}`));
      b.addEventListener('click', () => onPick(C.SIGNAL_KEYS[i]));
      w.appendChild(b);
    });
    show('wheel', w);
  }

  function paused() {
    const s = el('div', 'screen');
    const card = el('div', 'receipt closed');
    card.appendChild(el('h2', '', 'PAUSED'));
    card.appendChild(btn('RESUME', 'big', () => app.resume()));
    s.appendChild(card);
    show('paused', s);
  }

  function toast(text) {
    const t = el('div', 'toast', text);
    root.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  return { title, workshop, results, closed, watching, wheel, paused, toast, clear, get name() { return currentName; }, get node() { return current; }, get drawer() { return drawer; } };
}
