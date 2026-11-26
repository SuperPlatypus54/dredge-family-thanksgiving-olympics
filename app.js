import {
  CATCH_UP_START, DINNER_START, EVENTS, TARGETS, TEAMS, TOURNAMENT_START,
  formatScheduleTime, getBracketByes, getLineup, getMatches, getMatchState, getSubstitution,
  getTournamentStandings, roundLabel,
} from './tournament.js';
import { createDrawEditor } from './draw-editor.js';
import { setupFullscreen, watchScoreboard } from './display.js';
import { createScoreEditor } from './score-editor.js';
import { apiUrl, pageUrl } from './site-config.js';

const $ = id => document.getElementById(id);
const scorekeeperPath = pageUrl('score').pathname;
const organizer = [scorekeeperPath, `${scorekeeperPath}/`, `${scorekeeperPath}/index.html`].includes(location.pathname);
document.body.dataset.view = organizer ? 'scorekeeper' : 'spectator';
const tokenKey = 'dredge-olympics-token';
const statusLabel = { pending: 'Pending', upcoming: 'Scheduled', live: 'In play', final: 'Final' };
const dialog = $('match-dialog');
const content = $('dialog-content');
const roundFilters = new Map();
let state = { records: {}, revision: -1, draw: null };
let selectedEvent = EVENTS[0].id;
let token = organizer ? sessionStorage.getItem(tokenKey) ?? '' : '';
if (organizer) sessionStorage.removeItem('dredge-olympics-pin');
let openDetails = null;
let invoker = null;
let tiebreaks = [];

const currentTeams = () => state.draw?.teams ?? TEAMS;
const currentMatches = () => getMatches(currentTeams().length, state.records);
const sportMatches = event => currentMatches().filter(match => match.event === event);
const scoreOf = match => getMatchState(match, state.records[match.id]);
const finals = matches => matches.filter(match => match.home && match.away && scoreOf(match).status === 'final').length;
const hasScores = () => Object.values(state.records).some(record => record.actions.length > 0);
const teamLabel = team => team.players.join(' &amp; ') || `Team ${team.id}`;
const teamName = team => team.players.join(' & ') || `Team ${team.id}`;
const matchupReady = match => Boolean(match.home && match.away);
const sideLabel = (match, side) => match[side]
  ? teamLabel({ id: match[side], players: getLineup(match, side, state.draw) })
  : match[`${side}Label`] ?? 'To be decided';
const substituteNote = match => {
  const substitution = getSubstitution(match, state.draw);
  return substitution ? `${substitution.player} fills in for ${substitution.forPlayer} on Team ${substitution.team}.` : '';
};
const chip = id => `<span class="team-chip team-${id}" aria-label="Team ${id}">${id}</span>`;
const standingTeam = team => `<th scope="row"><span class="standings-team">${chip(team.id)} <span>${teamLabel(team)}</span></span></th>`;
const badge = status => `<span class="match-status ${status}">${statusLabel[status]}</span>`;

function timeMarkup(minute) {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `<time datetime="${hour}:${minutes}">${formatScheduleTime(minute)}</time>`;
}

function renderOrganizer() {
  if (!organizer) return;
  $('organizer-banner').hidden = !organizer;
  const button = $('organizer-button');
  button.hidden = Boolean(token) && hasScores();
  button.textContent = !token ? 'Unlock scorekeeper' : state.draw ? 'Edit teams' : 'Enter drawn teams';
  $('organizer-message').textContent = !token
    ? 'Enter the organizer PIN.'
    : state.draw ? 'Select a match or mini-game to enter its result.' : 'Enter the teams after drawing from the hat.';
}

function saveToken(value) {
  token = value;
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
  renderOrganizer();
}

function renderMatch(match) {
  const score = scoreOf(match);
  const ready = matchupReady(match);
  const status = ready ? score.status : 'pending';
  const note = substituteNote(match);
  const sides = ['home', 'away'].map(side => `<span class="fixture-team">
    ${match[side] ? chip(match[side]) : ''}<span><strong class="${match[side] ? '' : 'fixture-placeholder'}">${sideLabel(match, side)}</strong>
    ${ready && score.winner === side ? '<small class="winner-text">Won</small>' : ''}</span>
  </span>`);
  const center = ready && score.status !== 'upcoming' && match.event !== 'pool'
    ? `<b>${score.scores[0]}</b> : <b>${score.scores[1]}</b>`
    : 'vs';
  const time = Number.isInteger(match.startMinute) ? timeMarkup(match.startMinute) : '';
  const disabled = organizer && !ready;
  const title = disabled ? 'Waiting for the previous matches' : organizer && state.draw ? 'Score match' : 'Match details';
  return `<button type="button" class="fixture" data-match="${match.id}" title="${title}"${disabled ? ' disabled' : ''}>
    <span class="fixture-label">${match.label ?? roundLabel(match.round)}</span>
    ${sides[0]}<span class="fixture-score">${center}</span>${sides[1]}
    <span class="fixture-meta">${time}${badge(status)}</span>
    ${note ? `<span class="fixture-note">${note}</span>` : ''}
  </button>`;
}

function renderFixtures(matches, activeRound, rounds, event) {
  const focusedMatch = document.activeElement?.dataset.match;
  const visible = activeRound === 'All' ? rounds : [activeRound];
  const teams = currentTeams();
  const byes = getBracketByes(teams.length, event.id, state.records).map(id => teamLabel(teams.find(team => team.id === id)));
  $('fixtures').innerHTML = visible.map(round => {
    const group = matches.filter(match => match.round === round);
    const byeText = round === 1 && byes.length ? `<span>Semifinal byes · ${byes.join(' · ')}</span>` : '';
    return `<div class="fixture-round">
      <div class="round-heading"><h3>${roundLabel(round)}</h3>${byeText}</div>
      <div class="fixture-list">${group.map(renderMatch).join('')}</div>
    </div>`;
  }).join('');
  if (focusedMatch) $('fixtures').querySelector(`[data-match="${focusedMatch}"]`)?.focus({ preventScroll: true });
}

function resultLabel(standing, pending) {
  if (standing.winner) {
    return `${teamName(standing.winner)} won${standing.final ? '' : ' · Other places pending'}`;
  }
  return standing.complete ? 'Mini-games pending' : pending;
}

function focusTiebreak(id) {
  document.querySelector(`[data-tiebreak="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

function renderTiebreaks(container, scope) {
  const ties = tiebreaks.filter(tie => tie.scope === scope);
  const focusedTie = document.activeElement?.dataset.tiebreak;
  $(`${container}-tiebreak-section`).hidden = ties.length === 0;
  $(`${container}-tiebreaks`).innerHTML = ties.map(tie => {
    const winner = tie.teams.find(team => team.id === tie.winner);
    return `<div class="tiebreak-item">
      <div>
        <strong>Place ${tie.rank}</strong>
        <span>${tie.teams.map(teamLabel).join(' · ')}</span>
        <span class="${winner ? 'winner-text' : ''}">${winner ? `${teamLabel(winner)} won` : 'Winner pending'}</span>
      </div>
      ${organizer ? `<button type="button" class="tiebreak-action" data-tiebreak="${tie.id}">
        ${winner ? 'Edit result' : 'Record winner'}
      </button>` : ''}
    </div>`;
  }).join('');
  if (focusedTie) focusTiebreak(focusedTie);
}

function renderStandings(event, standing, completed) {
  $('standings-event').textContent = event.name;
  $('standings-rows').innerHTML = standing.rows.map(({ team, wins, losses, rank, points }) => `<tr${standing.winner?.id === team.id ? ' class="is-champion"' : ''}>
    <td>${completed ? rank : '–'}</td>${standingTeam(team)}
    <td>${wins}</td><td>${losses}</td><td class="points-cell">${points ?? '–'}</td>
  </tr>`).join('');
  $('standings-note').textContent = resultLabel(standing, 'Points are provisional until placements are settled.');
  renderTiebreaks('event', event.id);
}

function renderOverall({ events, overall }) {
  const anyPoints = Object.values(events).some(event => event.rows.some(row => row.points !== null));
  $('overall-events').innerHTML = EVENTS.map(event => {
    const standing = events[event.id];
    return `<div class="overall-event" data-sport="${event.id}">
      <strong>${event.name}</strong><span class="${standing.final ? 'winner-text' : ''}"></span>
    </div>`;
  }).join('');
  for (const card of $('overall-events').children) {
    card.querySelector('span').textContent = resultLabel(events[card.dataset.sport], 'Matches pending');
  }
  $('overall-result').textContent = resultLabel(overall, 'Sport results pending');
  $('overall-rows').innerHTML = overall.rows.map(({ team, rank, points, events: sportPoints }) => `<tr${overall.winner?.id === team.id ? ' class="is-champion"' : ''}>
    <td>${anyPoints ? rank : '–'}</td>${standingTeam(team)}
    ${EVENTS.map(event => `<td>${sportPoints[event.id] ?? '–'}</td>`).join('')}
    <td class="points-cell">${anyPoints ? points : '–'}</td>
  </tr>`).join('');
  $('overall-note').textContent = overall.final
    ? 'Final results'
    : 'Provisional totals include sports in progress. Tied places share points until their mini-game is recorded.';
  renderTiebreaks('overall', 'overall');
}

function renderEvent(standings) {
  const event = EVENTS.find(item => item.id === selectedEvent);
  const matches = sportMatches(event.id);
  const rounds = [...new Set(matches.map(match => match.round))];
  const filter = roundFilters.get(event.id);
  const activeRound = rounds.includes(filter) ? filter : 'All';
  const focusedRound = document.activeElement?.dataset.round;
  $('rounds').innerHTML = ['All', ...rounds].map(round => {
    const complete = round !== 'All' && matches.filter(match => match.round === round).every(match => scoreOf(match).status === 'final');
    const stage = round === 'All' ? 'All stages' : roundLabel(round);
    const label = complete ? `${stage}, complete` : stage;
    return `<button type="button" data-round="${round}" aria-label="${label}" aria-pressed="${round === activeRound}">${stage}${complete ? '<span class="round-check" aria-hidden="true">✓</span>' : ''}</button>`;
  }).join('');
  if (focusedRound) $('rounds').querySelector(`[data-round="${focusedRound}"]`)?.focus({ preventScroll: true });

  const completed = finals(matches);
  const timed = matches.some(match => Number.isInteger(match.startMinute));
  $('schedule-hours').hidden = !timed;
  const flexible = timed && event.id === 'cornhole' ? ' · Flexible times' : '';
  $('event-rule').textContent = `2v2 single elimination · ${event.rule}${flexible}`;
  $('event-progress').textContent = `${completed} / ${matches.length} played`;
  renderFixtures(matches, activeRound, rounds, event);
  renderStandings(event, standings.events[event.id], completed);
}

function render() {
  const standings = getTournamentStandings(state.records, currentTeams(), state.tiebreaks ?? {});
  const showingOverall = selectedEvent === 'overall';
  const finalSports = Object.values(standings.events).filter(event => event.final).length;
  tiebreaks = standings.tiebreaks;
  renderOrganizer();
  for (const button of $('events').children) {
    const id = button.dataset.event;
    const eventMatches = sportMatches(id);
    button.setAttribute('aria-pressed', String(id === selectedEvent));
    button.querySelector('.event-count').textContent = id === 'overall'
      ? `${finalSports}/${EVENTS.length}`
      : `${finals(eventMatches)}/${eventMatches.length}`;
  }
  $('event-dashboard').hidden = showingOverall;
  $('overall-dashboard').hidden = !showingOverall;
  if (showingOverall) renderOverall(standings);
  else renderEvent(standings);
  const allMatches = currentMatches();
  $('overall-progress').innerHTML = `<strong>${finals(allMatches)}</strong> / ${allMatches.length} matches`;
  renderRoster();
  if (openDetails && dialog.open) {
    const match = allMatches.find(item => item.id === openDetails);
    if (match) renderDetails(match);
  }
}

async function api(path, options) {
  const response = await fetch(apiUrl(path), { cache: 'no-store', signal: AbortSignal.timeout(8000), ...options });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function connection(online) {
  const indicator = organizer ? $('connection') : $('spectator-connection');
  indicator.classList.toggle('is-online', online);
  const label = indicator.querySelector('[data-connection-label]');
  const message = online ? 'Live scoreboard' : 'Reconnecting';
  if (label.textContent !== message) label.textContent = message;
}

function accept(next) {
  if (next.revision > state.revision) {
    state = next;
    render();
  }
}

const poll = watchScoreboard({ onState: accept, onConnection: connection });

function showDialog(title, context = '') {
  openDetails = null;
  $('dialog-title').textContent = title;
  $('dialog-context').textContent = context;
  content.replaceChildren();
  if (!dialog.open) {
    invoker = document.activeElement;
    dialog.showModal();
  }
}

function unlock(onUnlock) {
  showDialog('Unlock scorekeeper');
  content.innerHTML = `<form class="pin-form">
    <p>Enter the organizer PIN.</p>
    <label for="score-pin">Organizer PIN</label>
    <input type="password" id="score-pin" name="pin" inputmode="numeric" pattern="[0-9]{4,32}" autocomplete="off" required>
    <p class="form-error" role="alert" hidden></p>
    <button type="submit" class="button-primary">Unlock scorekeeper</button>
  </form>`;
  const form = content.querySelector('form');
  const input = form.elements.pin;
  const submit = form.querySelector('button');
  const feedback = form.querySelector('.form-error');
  input.focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    feedback.hidden = true;
    try {
      const session = await api('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: input.value }),
      });
      if (typeof session.token !== 'string' || !session.token) {
        throw new Error('The scorekeeper session could not be started.');
      }
      input.value = '';
      saveToken(session.token);
      if (dialog.open && form.isConnected) {
        if (onUnlock) onUnlock();
        else dialog.close();
      }
    } catch (error) {
      feedback.textContent = error.status === 401 ? error.message : 'Could not unlock the scorekeeper. Check your connection and try again.';
      feedback.hidden = false;
      submit.disabled = false;
      input.select();
    }
  });
}

function dartsLineupMarkup(match) {
  const lineup = state.records[match.id]?.darts_lineup;
  if (match.event !== 'darts' || !lineup || !matchupReady(match)) return '';
  const side = id => id === match.home ? 'home' : 'away';
  return `<section class="darts-lineup">
    <h3>DartConnect · Set ${lineup.set_number}</h3>
    <p>DartConnect left · Team ${lineup.left_team_id} · ${sideLabel(match, side(lineup.left_team_id))}</p>
    <p>DartConnect right · Team ${lineup.right_team_id} · ${sideLabel(match, side(lineup.right_team_id))}</p>
    <small>Verified <time datetime="${lineup.verified_at}">${new Date(lineup.verified_at).toLocaleString()}</time></small>
  </section>`;
}

function createDartsLineupEditor(match, draw) {
  const section = document.createElement('div');
  const lineup = state.records[match.id]?.darts_lineup;
  section.innerHTML = `<div data-lineup-summary>${dartsLineupMarkup(match)}</div>`;
  if (scoreOf(match).status === 'final') return section;
  section.insertAdjacentHTML('beforeend', `<details class="darts-lineup" ${lineup ? '' : 'open'}>
    <summary>${lineup ? 'Update DartConnect lineup' : 'Confirm DartConnect lineup'}</summary>
    <form class="pin-form">
      <label for="darts-set-number">Set number</label>
      <input id="darts-set-number" name="set_number" type="number" min="1" max="9007199254740991" step="1" required>
      <label for="darts-team-order">Left and right teams</label>
      <select id="darts-team-order" name="left_team_id" required>
        <option value="">Choose the order shown in DartConnect</option>
        <option value="${match.home}">Left · Team ${match.home} · ${sideLabel(match, 'home')} / Right · Team ${match.away} · ${sideLabel(match, 'away')}</option>
        <option value="${match.away}">Left · Team ${match.away} · ${sideLabel(match, 'away')} / Right · Team ${match.home} · ${sideLabel(match, 'home')}</option>
      </select>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="button-primary">Confirm lineup</button>
    </form>
  </details>`);
  const details = section.querySelector('details');
  const form = section.querySelector('form');
  const setInput = form.elements.set_number;
  const order = form.elements.left_team_id;
  const submit = form.querySelector('button');
  const feedback = form.querySelector('.form-error');
  let previousVerifiedAt = lineup?.verified_at ?? null;
  setInput.value = lineup?.set_number ?? '';
  order.value = lineup?.left_team_id ?? '';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    feedback.hidden = true;
    try {
      const result = await api(`/api/darts-lineup/${match.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          set_number: setInput.valueAsNumber,
          left_team_id: order.value,
          right_team_id: order.value === match.home ? match.away : match.home,
          previous_verified_at: previousVerifiedAt,
          drawVersion: draw.version,
        }),
      });
      accept(result);
      previousVerifiedAt = result.records[match.id].darts_lineup.verified_at;
      section.querySelector('[data-lineup-summary]').innerHTML = dartsLineupMarkup(match);
      details.querySelector('summary').textContent = 'Update DartConnect lineup';
      details.open = false;
    } catch (error) {
      if (error.status === 401) {
        saveToken('');
        if (section.isConnected && dialog.open) unlock(() => openMatch(match.id));
        return;
      }
      if (error.status === 409) await poll();
      feedback.textContent = error.message || 'Could not confirm the lineup.';
      feedback.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return section;
}

function renderDetails(match) {
  const score = scoreOf(match);
  const ready = matchupReady(match);
  const note = substituteNote(match);
  const sides = ['home', 'away'];
  const lines = sides.map((side, index) => {
    const won = score.winner === side;
    const points = !ready || score.status === 'upcoming' ? '' : match.event === 'pool' ? (won ? 'Win' : 'Loss') : score.scores[index];
    return `<div class="details-side">${match[side] ? chip(match[side]) : ''}
      <strong class="${match[side] ? '' : 'fixture-placeholder'}">${sideLabel(match, side)}</strong>
      <span class="${won ? 'winner-text' : ''}">${points}${won && match.event !== 'pool' ? ' · Won' : ''}</span>
    </div>`;
  }).join('');
  const hits = ready && match.event === 'darts' && state.records[match.id]?.actions.some(action => action.type === 'hit');
  const marks = hits ? `<table class="details-marks">
    <thead><tr><th scope="col">Team</th>${TARGETS.map(target => `<th scope="col">${target}</th>`).join('')}</tr></thead>
    <tbody>${sides.map((side, index) => `<tr><th scope="row">${match[side]}</th>${score.marks[index].map(count => `<td>${count}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>` : '';
  content.innerHTML = `<p class="details-lede">${badge(ready ? score.status : 'pending')}</p><div class="details-sides">${lines}</div>${marks}
    ${note ? `<p class="details-note">${note}</p>` : ''}${dartsLineupMarkup(match)}`;
}

async function save(match, actions, version, drawVersion) {
  try {
    const result = await api(`/api/match/${match.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ actions, version, drawVersion }),
    });
    accept(result);
    return result.records[match.id];
  } catch (error) {
    if (error.status === 401) {
      saveToken('');
      if (dialog.open) unlock(() => openMatch(match.id));
    }
    if (error.status === 409) {
      await poll();
      throw new Error('This match changed. Close it and reopen it to load the latest score.');
    }
    throw error;
  }
}

function openMatch(id) {
  const match = currentMatches().find(item => item.id === id);
  if (!match || (organizer && !matchupReady(match))) return;
  if (organizer && !token) return unlock(() => openMatch(id));
  if (organizer && !state.draw) return openDraw();
  const event = EVENTS.find(item => item.id === match.event);
  const planned = Number.isInteger(match.startMinute) ? ` · Planned ${formatScheduleTime(match.startMinute)}` : '';
  showDialog(organizer ? 'Score match' : 'Match details', `${event.name} · ${match.label ?? roundLabel(match.round)}${planned}`);
  if (organizer) {
    const draw = state.draw;
    if (match.event === 'darts') content.append(createDartsLineupEditor(match, draw));
    content.append(createScoreEditor({
      match,
      draw,
      record: state.records[match.id],
      onSave: (actions, version) => save(match, actions, version, draw.version),
    }));
  } else {
    openDetails = match.id;
    renderDetails(match);
  }
}

function openDraw() {
  if (!token) return unlock(openDraw);
  if (hasScores()) return;
  const { revision, draw } = state;
  showDialog(draw ? 'Edit drawn teams' : 'Enter drawn teams');
  const editor = createDrawEditor({
    draw,
    onSave: async (teams, substitute) => {
      try {
        const result = await api('/api/draw', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teams, substitute, revision }),
        });
        accept(result);
        if (editor.isConnected && dialog.open) dialog.close();
      } catch (error) {
        if (error.status === 401) {
          saveToken('');
          if (editor.isConnected && dialog.open) unlock(openDraw);
        }
        if (error.status === 409) await poll();
        throw error;
      }
    },
  });
  content.append(editor);
  editor.querySelector('select')?.focus();
}

function openTiebreak(id) {
  if (!organizer) return;
  if (!token) return unlock(() => openTiebreak(id));
  const tie = tiebreaks.find(item => item.id === id);
  if (!tie) {
    if (dialog.open) dialog.close();
    return;
  }
  const revision = state.revision;
  const scope = EVENTS.find(event => event.id === tie.scope)?.name ?? 'Overall';
  showDialog('Mini-game result', `${scope} · Place ${tie.rank}`);
  content.innerHTML = `<form class="pin-form tiebreak-form">
    <p>Play the mini-game, then enter the winner.</p>
    <label for="tiebreak-winner">Winner</label>
    <select id="tiebreak-winner" name="winner">
      <option value="">No winner recorded</option>
      ${tie.teams.map(team => `<option value="${team.id}">${teamLabel(team)}</option>`).join('')}
    </select>
    <p class="form-error" role="alert" hidden></p>
    <button class="button-primary" type="submit" disabled>Save winner</button>
  </form>`;
  const form = content.querySelector('form');
  const select = form.elements.winner;
  const submit = form.querySelector('button');
  const feedback = form.querySelector('.form-error');
  const previous = tie.winner ?? '';
  select.value = previous;
  select.focus();

  function updateSubmit() {
    submit.disabled = select.disabled || select.value === previous;
    submit.textContent = select.value || !previous ? 'Save winner' : 'Clear winner';
  }

  select.addEventListener('change', updateSubmit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const winner = select.value || null;
    select.disabled = true;
    submit.disabled = true;
    feedback.hidden = true;
    try {
      const result = await api('/api/tiebreak', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, winner, revision }),
      });
      accept(result);
      if (form.isConnected && dialog.open) dialog.close();
    } catch (error) {
      if (error.status === 401) {
        saveToken('');
        if (form.isConnected && dialog.open) unlock(() => openTiebreak(id));
        return;
      }
      if (error.status === 409) await poll();
      feedback.textContent = error.status === 409
        ? 'Standings changed. Close and reopen this mini-game to see the latest result.'
        : error.message || 'Could not save the mini-game result.';
      feedback.hidden = false;
    } finally {
      select.disabled = false;
      updateSubmit();
    }
  });
}

function renderRoster() {
  const teams = currentTeams();
  const playerCount = state.draw ? new Set(teams.flatMap(team => team.players)).size : teams.length * 2;
  $('player-count').textContent = `${playerCount} players`;
  $('teams-description').textContent = state.draw
    ? 'All three events use the same draw.'
    : 'Team names will appear after the hat draw.';
  $('team-list').innerHTML = teams.map(team => `<div class="roster-team">
    ${chip(team.id)} <strong>${teamLabel(team)}</strong>
  </div>`).join('');
  const note = $('roster-note');
  note.hidden = !state.draw?.sharedPlayer;
  if (state.draw?.sharedPlayer) {
    const { sharedPlayer, sharedTeams, substitute } = state.draw;
    note.textContent = `${sharedPlayer} plays for Teams ${sharedTeams.join(' and ')}. ${substitute} fills in on Team ${sharedTeams[1]} if those teams meet. Play ${sharedPlayer}’s matches one at a time.`;
  }
}

$('events').innerHTML = [...EVENTS, { id: 'overall', name: 'Overall', rule: 'Tournament points' }].map(event => `<button type="button" class="event-button" data-event="${event.id}">
  <span class="event-icon ${event.id}" aria-hidden="true"></span>
  <span class="event-label"><strong>${event.name}</strong><small>${event.rule}</small></span>
  <span class="event-count" aria-hidden="true"></span>
</button>`).join('');
$('schedule-hours').innerHTML = [
  ['Start', TOURNAMENT_START], ['Catch-up', CATCH_UP_START], ['Dinner', DINNER_START],
].map(([label, minute]) => `<span>${label} ${timeMarkup(minute)}</span>`).join('');
if (organizer) {
  $('view-link').href = pageUrl('');
  $('view-link').innerHTML = 'Spectator view <span aria-hidden="true">↗</span>';
  renderOrganizer();
} else {
  setupFullscreen($('spectator-fullscreen'));
}

$('events').addEventListener('click', event => {
  const button = event.target.closest('[data-event]');
  if (!button) return;
  selectedEvent = button.dataset.event;
  render();
});
$('rounds').addEventListener('click', event => {
  const button = event.target.closest('[data-round]');
  if (!button) return;
  const round = button.dataset.round;
  roundFilters.set(selectedEvent, round === 'All' ? round : Number(round));
  render();
});
$('fixtures').addEventListener('click', event => {
  const button = event.target.closest('[data-match]');
  if (button) openMatch(button.dataset.match);
});
for (const container of ['event-tiebreaks', 'overall-tiebreaks']) {
  $(container).addEventListener('click', event => {
    const button = event.target.closest('[data-tiebreak]');
    if (button) openTiebreak(button.dataset.tiebreak);
  });
}
$('organizer-button').addEventListener('click', openDraw);
$('dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  openDetails = null;
  if (invoker?.isConnected && !invoker.hidden) invoker.focus({ preventScroll: true });
  else if (invoker?.dataset.match) $('fixtures').querySelector(`[data-match="${invoker.dataset.match}"]`)?.focus({ preventScroll: true });
  else if (invoker?.dataset.tiebreak) focusTiebreak(invoker.dataset.tiebreak);
});
render();
poll();
