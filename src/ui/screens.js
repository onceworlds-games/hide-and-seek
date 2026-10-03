// DOM screens: the title (one button), the workshop (lobby: expedition picker, seats, upgrades,
// cosmetics), results, the room-closed card, the signal wheel and the "join at checkpoint" offer.
// Labels, not sentences. Every string from another player goes through textContent.
import * as C from '../sim/constants.js';
import { BIOMES, EXPEDITIONS, MUTATORS, MUTATOR_IDS, expeditionId } from '../sim/courses.js';
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
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick?.(e);
  });
  return b;
};

export function createScreens(root, app) {
  let current = null;
  let currentName = '';
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

  function title() {
    const s = el('div', 'screen');
    s.appendChild(el('h1', 'title-word', 'LEGWORK'));
    const play = btn('PLAY', 'big', () => app.play());
    s.appendChild(play);
    show('title', s);
    play.focus();
  }

  /** The workshop: the lobby. `m` is the model built by the app each refresh. */
  function workshop(m) {
    const s = el('div', 'screen lobby');
    const grid = el('div', 'workshop');
    // --- Expedition / mode (host picks; others see)
    const pick = el('div', 'panel');
    const head = el('div', 'row');
    head.appendChild(el('h3', '', m.isHost ? 'EXPEDITION' : `${m.hostName || 'HOST'} PICKS`));
    const scrap = el('span', 'scrap', `${m.save.scrap} SCRAP`);
    scrap.style.marginLeft = 'auto';
    head.appendChild(scrap);
    pick.appendChild(head);
    const modes = el('div', 'chips');
    for (const [id, label] of [['expedition', 'Expedition'], ['endless', 'Endless Stride'], ['daily', 'Daily']]) {
      const c = el('button', `chip ${m.setup.mode === id ? 'on' : ''}`, label);
      c.disabled = !m.isHost;
      c.addEventListener('click', () => app.setSetup({ ...m.setup, mode: id }));
      modes.appendChild(c);
    }
    pick.appendChild(modes);
    if (m.setup.mode === 'expedition') {
      const biomes = el('div', 'chips');
      biomes.style.marginTop = '8px';
      const unlocked = unlockedCount(m.save);
      for (let b = 0; b < 6; b++) {
        const open = unlocked > b * 4;
        const c = el('button', `chip ${m.setup.biome === b ? 'on' : ''} ${open ? '' : 'locked'}`, BIOMES[b].name);
        c.disabled = !m.isHost || !open;
        c.addEventListener('click', () => app.setSetup({ ...m.setup, biome: b, index: 0 }));
        biomes.appendChild(c);
      }
      pick.appendChild(biomes);
      const exps = el('div', 'chips');
      exps.style.marginTop = '8px';
      for (let i = 0; i < 4; i++) {
        const id = expeditionId(m.setup.biome, i);
        const open = unlocked > m.setup.biome * 4 + i;
        const medal = m.save.medals[id];
        const c = el('button', `chip ${m.setup.index === i ? 'on' : ''} ${open ? '' : 'locked'} ${medal === 'gold' ? 'gold' : ''}`, `${i + 1}. ${EXPEDITIONS[m.setup.biome * 4 + i].name}`);
        if (medal) c.appendChild(el('span', 'cost', medal === 'gold' ? '★★★' : medal === 'silver' ? '★★' : '★'));
        if (m.save.best[id]) c.appendChild(el('span', 'cost', fmtTime(m.save.best[id])));
        c.disabled = !m.isHost || !open;
        c.addEventListener('click', () => app.setSetup({ ...m.setup, index: i }));
        exps.appendChild(c);
      }
      pick.appendChild(exps);
      const ghostRow = el('div', 'chips');
      ghostRow.style.marginTop = '8px';
      const gid = expeditionId(m.setup.biome, m.setup.index);
      const hasGhost = !!m.save.ghosts[gid];
      const g = el('button', `chip ${m.setup.ghost && hasGhost ? 'on' : ''} ${hasGhost ? '' : 'locked'}`, hasGhost ? 'Race your ghost' : 'No ghost yet');
      g.disabled = !m.isHost || !hasGhost;
      g.addEventListener('click', () => app.setSetup({ ...m.setup, ghost: !m.setup.ghost }));
      ghostRow.appendChild(g);
      pick.appendChild(ghostRow);
    } else if (m.setup.mode === 'daily') {
      const info = el('div', 'chips');
      info.style.marginTop = '8px';
      info.appendChild(el('span', 'chip on', `${BIOMES[m.daily.biome].name}`));
      info.appendChild(el('span', 'chip', MUTATORS[m.daily.mutators[0]]?.name ?? 'Mutator'));
      info.appendChild(el('span', 'chip', `Day ${m.daily.day}`));
      pick.appendChild(info);
    } else {
      const info = el('div', 'chips');
      info.style.marginTop = '8px';
      info.appendChild(el('span', 'chip', `Best ${m.save.endlessBest} m`));
      pick.appendChild(info);
    }
    if (m.setup.mode !== 'daily') {
      const muts = el('div', 'chips');
      muts.style.marginTop = '8px';
      for (const id of MUTATOR_IDS) {
        const on = m.setup.mutators.includes(id);
        const c = el('button', `chip ${on ? 'on' : ''}`, MUTATORS[id].name);
        c.disabled = !m.isHost;
        c.addEventListener('click', () => app.setSetup({ ...m.setup, mutators: on ? m.setup.mutators.filter((x) => x !== id) : [...m.setup.mutators, id] }));
        muts.appendChild(c);
      }
      pick.appendChild(muts);
    }
    grid.appendChild(pick);
    // --- Seats
    const seats = el('div', 'panel');
    seats.appendChild(el('h3', '', 'LEGS'));
    const srow = el('div', 'chips');
    for (let i = 0; i < 4; i++) {
      const id = m.seats[i];
      const pl = id ? m.players.get(id) : null;
      const seat = el('button', `seat ${id === m.me ? 'mine' : ''}`);
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
        const name = el('span', 'name', pl.name || 'Player');
        seat.appendChild(name);
        if (id === m.host) seat.appendChild(el('span', 'cost', 'HOST'));
        if (pl.ready) seat.appendChild(el('span', 'cost', '✓'));
      } else {
        seat.appendChild(el('span', 'name', 'Bot'));
      }
      seat.title = C.LEG_NAMES[i];
      seat.addEventListener('click', () => {
        if (!id) app.claimSeat(i);
      });
      srow.appendChild(seat);
    }
    seats.appendChild(srow);
    if (m.players.size < 4) {
      const inv = btn('INVITE', 'small brass', () => app.invite());
      inv.style.marginTop = '8px';
      seats.appendChild(inv);
    }
    if (m.humans === 1) {
      const note = el('div', 'chips');
      note.style.marginTop = '8px';
      note.appendChild(el('span', 'chip', 'Pilot: you steer, three bots step'));
      seats.appendChild(note);
    }
    grid.appendChild(seats);
    // --- Upgrades (own save)
    const up = el('div', 'panel');
    up.appendChild(el('h3', '', 'WORKSHOP'));
    const feetRow = el('div', 'chips');
    for (const [id, f] of Object.entries(C.FEET)) {
      const owned = m.save.feetOwned.includes(id);
      const c = el('button', `chip ${m.save.feet === id ? 'on' : ''}`, `${f.name}`);
      if (!owned) c.appendChild(el('span', 'cost', `${f.cost}`));
      c.disabled = !owned && m.save.scrap < f.cost;
      c.addEventListener('click', () => app.buyFeet(id));
      feetRow.appendChild(c);
    }
    up.appendChild(el('div', 'row', 'Feet'));
    up.appendChild(feetRow);
    const levelRow = (label, levels, value, key) => {
      const row = el('div', 'chips');
      levels.forEach((lv, i) => {
        const c = el('button', `chip ${value === i ? 'on' : ''}`, lv.name);
        if (i > value) c.appendChild(el('span', 'cost', `${lv.cost}`));
        c.disabled = i > value + 1 || (i > value && m.save.scrap < lv.cost);
        c.addEventListener('click', () => app.buyLevel(key, i));
        row.appendChild(c);
      });
      up.appendChild(el('div', 'row', label));
      up.appendChild(row);
    };
    levelRow('Hips', C.HIPS_LEVELS, m.save.hips, 'hips');
    const chassisRow = el('div', 'chips');
    for (const [id, ch] of Object.entries(C.CHASSIS)) {
      const owned = m.save.chassisOwned.includes(id);
      const c = el('button', `chip ${m.save.chassis === id ? 'on' : ''}`, ch.name);
      if (!owned) c.appendChild(el('span', 'cost', `${ch.cost}`));
      c.disabled = !owned && m.save.scrap < ch.cost;
      c.addEventListener('click', () => app.buyChassis(id));
      chassisRow.appendChild(c);
    }
    up.appendChild(el('div', 'row', 'Chassis'));
    up.appendChild(chassisRow);
    levelRow('Cradle', C.CRADLE_LEVELS, m.save.cradle, 'cradle');
    levelRow('Mechanic', C.MECHANIC_LEVELS, m.save.mechanic, 'mechanic');
    grid.appendChild(up);
    // --- Cosmetics
    const cos = el('div', 'panel');
    cos.appendChild(el('h3', '', 'PAINT SHOP'));
    const cosRow = (label, list, value, key) => {
      const row = el('div', 'chips');
      for (const item of list) {
        const owned = m.save.cosmetics.includes(item.id);
        const c = el('button', `chip ${value === item.id ? 'on' : ''}`, item.name);
        if (item.color) {
          const sw = el('span', 'swatch');
          sw.style.cssText = `display:inline-block;width:14px;height:14px;border-radius:4px;border:2px solid #2a1e1a;margin-right:6px;vertical-align:middle;background:${item.color}`;
          c.prepend(sw);
        }
        if (!owned) c.appendChild(el('span', 'cost', `${item.cost}`));
        c.disabled = !owned && m.save.scrap < item.cost;
        c.addEventListener('click', () => app.buyCosmetic(key, item.id));
        row.appendChild(c);
      }
      cos.appendChild(el('div', 'row', label));
      cos.appendChild(row);
    };
    cosRow('Paint', PAINTS, m.save.paint, 'paint');
    cosRow('Stickers', STICKERS, m.save.sticker, 'sticker');
    cosRow('Cargo hat', HATS, m.save.hat, 'hat');
    cosRow('Horn', HORNS, m.save.horn, 'horn');
    grid.appendChild(cos);
    if (m.results) grid.prepend(resultsCard(m.results, m, true));
    if (m.standalone && m.isHost) {
      const start = btn('START', 'big teal', () => app.start());
      start.id = 'start';
      start.disabled = !m.canStart;
      grid.prepend(start);
    }
    s.appendChild(grid);
    s.style.overflowY = 'auto';
    s.style.justifyContent = 'flex-start';
    show('workshop', s);
  }

  function resultsCard(r, m, inLobby) {
    const card = el('div', 'card');
    card.appendChild(el('h2', '', r.finished ? (r.medal === 'gold' ? 'GOLD STRIDE' : r.medal === 'silver' ? 'SILVER STRIDE' : 'MADE IT') : r.why === 'tumbles' ? 'OUT OF TUMBLES' : 'RUN OVER'));
    const medal = el('span', `medal ${r.medal ?? 'none'}`, r.finished ? (r.medal ?? 'bronze').toUpperCase() : r.kind === 'endless' ? `${r.distance} M` : `${r.progress}%`);
    card.appendChild(medal);
    const grid = el('div', 'stat-grid');
    const stat = (v, label) => {
      const d = el('div', 'stat', String(v));
      d.appendChild(el('small', '', label));
      grid.appendChild(d);
    };
    stat(fmtTime(r.time), 'Time');
    stat(r.tumbles, 'Tumbles');
    stat(`${Math.round(r.cond * 100)}%`, 'Cargo');
    stat(`${r.grooveAvg}`, 'Groove');
    stat(`+${r.scrap}`, 'Scrap');
    card.appendChild(grid);
    if (r.legNames) {
      const row = el('div', 'chips');
      r.legNames.forEach((n, i) => {
        const chip = el('span', 'chip');
        const sw = el('span', 'swatch');
        sw.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;border:2px solid #2a1e1a;margin-right:6px;background:${C.LEG_COLORS[i]}`;
        chip.appendChild(sw);
        chip.appendChild(document.createTextNode(n));
        row.appendChild(chip);
      });
      card.appendChild(row);
    }
    if (!inLobby) {
      const row = el('div', 'row center');
      row.style.marginTop = '12px';
      if (m.isHost) row.appendChild(btn('WORKSHOP', 'teal', () => app.backToWorkshop()));
      else row.appendChild(el('span', 'chip', `Waiting for ${m.hostName || 'host'}`));
      card.appendChild(row);
    }
    return card;
  }

  function results(r, m) {
    const s = el('div', 'screen');
    s.appendChild(resultsCard(r, m, false));
    show('results', s);
  }

  function closed(reason) {
    const s = el('div', 'screen');
    const card = el('div', 'card closed');
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
      b.appendChild(el('b', '', `${i + 1}`));
      b.addEventListener('click', () => onPick(C.SIGNAL_KEYS[i]));
      w.appendChild(b);
    });
    show('wheel', w);
  }

  function paused() {
    const s = el('div', 'screen');
    const card = el('div', 'card');
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

  return { title, workshop, results, closed, watching, wheel, paused, toast, clear, get name() { return currentName; }, get node() { return current; } };
}
