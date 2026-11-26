import { setupFullscreen, watchScoreboard } from './display.js';
import {
  CATCH_UP_START, DINNER_START, EVENTS, TEAMS, TOURNAMENT_START,
  formatScheduleTime, getBracketByes, getLineup, getMatches, getMatchState,
  getTournamentStandings, roundLabel,
} from './tournament.js';

const eventOrder = ['darts', 'pool', 'cornhole'].map(id => EVENTS.find(event => event.id === id));
const order = [...eventOrder, { id: 'overall', name: 'Overall' }];
const rotationMs = 15_000;
const start = performance.now();
const find = id => document.getElementById(id);
const stage = find('stream-stage');
const board = find('stream-board');
const overallBoard = find('stream-overall');
const connection = find('stream-connection');
const nextGame = find('stream-next');
const progress = find('stream-time');
const day = find('stream-day');
const sides = ['home', 'away'];
const statusLabels = { upcoming: 'Scheduled', live: 'In play', final: 'Final' };
let index = 0;
let state = { draw: null, records: {}, revision: -1 };

function fitStage() {
  const { clientWidth, clientHeight } = document.body;
  const scale = Math.min(clientWidth / stage.offsetWidth, clientHeight / stage.offsetHeight);
  stage.style.setProperty('--stream-scale', scale);
}

function teamChip(id) {
  return `<span class="team-chip team-${id}" aria-hidden="true">${id}</span>`;
}

function standingTeam(team) {
  return `<th scope="row"><span class="stream-standing-team">${teamChip(team.id)}
    <span>${team.players.join(' &amp; ') || `Team ${team.id}`}</span>
  </span></th>`;
}

function teamName(team) {
  return team.players.join(' & ') || `Team ${team.id}`;
}

function miniGameNote(tiebreaks, scope) {
  const pending = tiebreaks.filter(tiebreak => tiebreak.scope === scope && !tiebreak.winner);
  if (pending.length === 1) {
    const teams = pending[0].teams.map(team => team.id).join(', ');
    return `Mini-game pending for Teams ${teams}.`;
  }
  return pending.length ? `${pending.length} tie-break mini-games pending.` : 'Waiting for the tie-break mini-game.';
}

function matchCard(match, result) {
  const timed = Number.isInteger(match.startMinute);
  const heading = `<div class="stream-match-time"><span>${match.label}</span>
    ${timed ? `<span>${formatScheduleTime(match.startMinute)}</span>` : ''}
  </div>`;
  const rows = sides.map((side, sideIndex) => {
    const id = match[side];
    const name = id
      ? getLineup(match, side, state.draw).join(' &amp; ') || `Team ${id}`
      : match[`${side}Label`];
    const won = result.winner === side;
    let points = '–';
    if (result.status !== 'upcoming') {
      points = match.event === 'pool' ? (won ? 'W' : 'L') : result.scores[sideIndex];
    }
    return `<div class="stream-side${won ? ' is-winner' : ''}${id ? '' : ' is-unassigned'}">
      ${id ? teamChip(id) : ''}<span class="stream-name">${name}</span>
      <strong class="stream-points">${won ? '<span class="stream-check" aria-label="Winner">✓</span>' : ''}${points}</strong>
    </div>`;
  });
  return `<div class="stream-match is-${result.status}${timed ? ' is-timed' : ''}" title="${statusLabels[result.status]}" data-match="${match.id}">
    ${heading}${rows.join('')}
  </div>`;
}

function renderSchedule(matches, teamCount, eventId) {
  const rounds = new Map();
  for (const match of matches) {
    if (!rounds.has(match.round)) rounds.set(match.round, []);
    rounds.get(match.round).push(match);
  }

  const byes = getBracketByes(teamCount, eventId);
  find('stream-rounds').innerHTML = Array.from(rounds, ([number, group], roundIndex) => {
    const byeNote = roundIndex === 0 && byes.length
      ? `<p>Byes for ${byes.map(id => `Team ${id}`).join(' and ')}</p>`
      : '';
    return `<section class="stream-round">
      <div class="stream-round-label">
        <h3>${roundLabel(number)}</h3>
        ${byeNote}
      </div>
      <div class="stream-round-matches">
        ${group.map(match => matchCard(match, getMatchState(match, state.records[match.id]))).join('')}
      </div>
    </section>`;
  }).join('');
}

function renderStandings(event, tournament, completed) {
  const result = tournament.events[event.id];
  find('stream-standings').innerHTML = result.rows.map(({ team, wins, losses, rank, points }) =>
    `<tr${result.winner?.id === team.id ? ' class="is-champion"' : ''}>
      <td>${completed ? (rank ?? '–') : '–'}</td>
      ${standingTeam(team)}
      <td>${wins}</td>
      <td>${losses}</td>
      <td>${points ?? '–'}</td>
    </tr>`
  ).join('');

  let note = 'Placement points post once final places are set.';
  if (result.winner) {
    note = `${event.name} champions are ${teamName(result.winner)}.`;
    if (!result.final) note += ` ${miniGameNote(tournament.tiebreaks, event.id)}`;
  } else if (result.complete) {
    note = miniGameNote(tournament.tiebreaks, event.id);
  }
  find('stream-standing-note').textContent = note;
}

function renderOverall(tournament) {
  const result = tournament.overall;
  const finalized = Object.values(tournament.events).filter(event => event.final).length;
  find('stream-overall-progress').textContent = `${finalized} / ${EVENTS.length} sports final`;
  find('stream-overall-rows').innerHTML = result.rows.map(({ team, rank, points, events }) =>
    `<tr${result.winner?.id === team.id ? ' class="is-champion"' : ''}>
      <td>${finalized ? rank : '–'}</td>
      ${standingTeam(team)}
      ${EVENTS.map(event => `<td>${events[event.id] ?? '–'}</td>`).join('')}
      <td>${finalized ? points : '–'}</td>
    </tr>`
  ).join('');

  let note = finalized
    ? 'Provisional standings. Points count from finalized sports.'
    : 'Placement points appear when the first sport is final.';
  if (result.winner) {
    note = `Thanksgiving Olympics champions are ${teamName(result.winner)}.`;
    if (!result.final) note += ` ${miniGameNote(tournament.tiebreaks, 'overall')}`;
  } else if (result.complete) {
    note = miniGameNote(tournament.tiebreaks, 'overall');
  }
  find('stream-overall-note').textContent = note;
}

function render() {
  const event = order[index];
  const teams = state.draw?.teams ?? TEAMS;
  const fixtures = getMatches(teams.length, state.records);
  const tournament = getTournamentStandings(state.records, teams, state.tiebreaks);
  const isOverall = event.id === 'overall';
  const timed = fixtures.some(match => Number.isInteger(match.startMinute));

  document.body.dataset.event = event.id;
  day.hidden = !timed;
  board.hidden = isOverall;
  overallBoard.hidden = !isOverall;
  find('stream-event').textContent = event.name;
  if (isOverall) {
    find('stream-rule').textContent = 'Placement points across all three sports';
    renderOverall(tournament);
    return;
  }

  const matches = fixtures.filter(match => match.event === event.id);
  const completed = matches.filter(match => getMatchState(match, state.records[match.id]).status === 'final').length;
  find('stream-rule').textContent = `${event.rule} · 2v2 single elimination`;
  find('stream-played').textContent = `${completed} / ${matches.length} played`;
  renderStandings(event, tournament, completed);
  renderSchedule(matches, teams.length, event.id);
}

function tick() {
  const elapsed = performance.now() - start;
  const active = Math.floor(elapsed / rotationMs) % order.length;
  if (active !== index) {
    index = active;
    render();
  }

  const remaining = rotationMs - elapsed % rotationMs;
  const next = order[(index + 1) % order.length].name;
  const label = `${next} next in ${Math.ceil(remaining / 1000)}s`;
  if (nextGame.textContent !== label) nextGame.textContent = label;
  progress.style.transform = `scaleX(${remaining / rotationMs})`;
}

find('stream-start').textContent = formatScheduleTime(TOURNAMENT_START);
find('stream-catch-up').textContent = formatScheduleTime(CATCH_UP_START);
find('stream-dinner').textContent = formatScheduleTime(DINNER_START);
fitStage();
window.addEventListener('resize', fitStage);
setupFullscreen(null);
render();
tick();
setInterval(tick, 200);

const refresh = watchScoreboard({
  onState(next) {
    if (next.revision === state.revision) return;
    state = next;
    render();
  },
  onConnection(online) {
    connection.classList.toggle('is-online', online);
    const label = online ? 'Live scores' : 'Reconnecting';
    if (connection.textContent !== label) connection.textContent = label;
  },
});
void refresh();
