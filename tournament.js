export const PLAYERS = [
  'Charlie', 'Diane', 'Evan', 'Ian', 'Jamie', 'John', 'Kate',
  'Marilyn', 'Matt', 'Max', 'Mia', 'Rich', 'Steve',
];
export const CONFIRMED_TEAMS = [
  { id: 'A', players: ['Marilyn', 'Charlie'] },
  { id: 'B', players: ['Ian', 'Evan'] },
  { id: 'C', players: ['Steve', 'Matt'] },
  { id: 'D', players: ['Rich', 'Mia'] },
  { id: 'E', players: ['Max', 'John'] },
  { id: 'F', players: ['Diane', 'Kate'] },
];
export const TEAM_IDS = CONFIRMED_TEAMS.map(team => team.id);
export const TEAMS = TEAM_IDS.map(id => ({ id, players: [] }));

export const CORNHOLE_TARGET = 11;
export const CORNHOLE_MAX_FRAME = 12;
export const PLACEMENT_POINTS = [15, 12, 9, 6, 3, 0];

export const TOURNAMENT_START = 11 * 60 + 30;
export const DINNER_START = 15 * 60 + 30;
const MATCH_MINUTES = { cornhole: 10, darts: 15, pool: 15 };
export const CATCH_UP_START = TOURNAMENT_START + 5 * (10 + 15 + 15);

export function formatScheduleTime(minute) {
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const EVENTS = [
  { id: 'cornhole', name: 'Cornhole', rule: `First to ${CORNHOLE_TARGET}+` },
  { id: 'darts', name: 'Darts', rule: 'Cricket' },
  { id: 'pool', name: 'Pool', rule: 'Win or loss' },
];

export const TARGETS = ['20', '19', '18', '17', '16', '15', 'Bull'];
const TARGET_VALUES = [20, 19, 18, 17, 16, 15, 25];
const SIDES = ['home', 'away'];

// Independently shuffled once so every display sees the same bracket.
const BRACKET_SEEDS = { cornhole: 'ABDFEC', darts: 'ADEFCB', pool: 'CEDFBA' };

export function roundLabel(round) {
  return ['Quarterfinals', 'Semifinals', 'Final'][round - 1];
}

export function getBracketByes(teamCount, event) {
  return [...BRACKET_SEEDS[event].slice(0, teamCount === 7 ? 1 : 2)];
}

function buildBracket(event, teamCount, firstMinute, records) {
  const [first, second, a, b, c, d] = BRACKET_SEEDS[event];
  const matches = [];
  const add = (round, label, home, away, homeMatch, awayMatch) => {
    const from = match => {
      if (!match?.home || !match.away || !records[match.id]) return null;
      const { winner } = getMatchState(match, records[match.id]);
      return winner ? match[winner] : null;
    };
    const match = {
      id: `bracket-${event}-${matches.length + 1}`, event, round, label,
      startMinute: firstMinute + matches.length * MATCH_MINUTES[event],
      home: homeMatch ? from(homeMatch) : home, away: awayMatch ? from(awayMatch) : away,
      homeFrom: homeMatch?.id ?? null, awayFrom: awayMatch?.id ?? null,
      homeLabel: homeMatch ? `Winner of ${homeMatch.label}` : `Team ${home}`,
      awayLabel: awayMatch ? `Winner of ${awayMatch.label}` : `Team ${away}`,
    };
    matches.push(match);
    return match;
  };

  const q1 = add(1, 'Quarterfinal 1', a, b);
  const q2 = add(1, 'Quarterfinal 2', c, d);
  const q3 = teamCount === 7 ? add(1, 'Quarterfinal 3', second, 'G') : null;
  const s1 = add(2, 'Semifinal 1', first, null, null, q1);
  const s2 = add(2, 'Semifinal 2', second, null, q3, q2);
  add(3, 'Final', null, null, s1, s2);
  return matches;
}

export function getMatches(teamCount, records = {}) {
  let start = TOURNAMENT_START;
  return EVENTS.flatMap(({ id }) => {
    const matches = buildBracket(id, teamCount, start, records);
    start += matches.length * MATCH_MINUTES[id];
    return matches;
  });
}

export const MATCHES = getMatches(6);

export function inspectTeams(teams) {
  if (!Array.isArray(teams) || ![6, 7].includes(teams.length)) {
    throw new Error('Enter two players for each team.');
  }

  const teamIds = teams.length === 7 ? [...TEAM_IDS, 'G'] : TEAM_IDS;
  const normalized = teamIds.map(id => {
    const entries = teams.filter(team => team?.id === id);
    const players = entries[0]?.players;
    if (entries.length !== 1 || !Array.isArray(players) || players.length !== 2
      || !players.every(player => PLAYERS.includes(player))) {
      throw new Error(`Choose two players for Team ${id}.`);
    }
    if (players[0] === players[1]) {
      throw new Error(`Choose two different players for Team ${id}.`);
    }
    return { id, players: [...players] };
  });

  const seats = normalized.flatMap(team => team.players);
  if (normalized.length === 6) {
    if (new Set(seats).size !== seats.length) {
      throw new Error('Enter 12 different players across the six teams.');
    }
    return { teams: normalized, sharedPlayer: null, sharedTeams: [], headToHeadRound: null, byeTeam: null };
  }

  if (new Set(seats).size !== PLAYERS.length) {
    throw new Error('Include all 13 players. One player appears on two teams.');
  }

  const sharedPlayer = seats.find((player, index) => seats.indexOf(player) !== index);
  const sharedTeams = normalized.filter(team => team.players.includes(sharedPlayer)).map(team => team.id);
  const headToHeadRound = null;
  const byeTeam = normalized.find(team => !sharedTeams.includes(team.id));
  return { teams: normalized, sharedPlayer, sharedTeams, headToHeadRound, byeTeam };
}

export function getSubstitution(match, draw) {
  if (!draw || !draw.sharedTeams.includes(match.home) || !draw.sharedTeams.includes(match.away)) return null;
  return { player: draw.substitute, forPlayer: draw.sharedPlayer, team: draw.sharedTeams[1] };
}

export function getLineup(match, side, draw) {
  const team = draw?.teams.find(item => item.id === match[side]);
  if (!team) return [];

  const substitute = getSubstitution(match, draw);
  return team.players.map(player =>
    substitute?.team === team.id && player === substitute.forPlayer ? substitute.player : player
  );
}

function validateScores(action, maximum) {
  const scores = [action.home, action.away];
  if (scores.some(score => !Number.isSafeInteger(score) || score < 0)) {
    throw new Error('Enter a whole number of zero or more for each team.');
  }
  if (maximum !== undefined && scores.some(score => score > maximum)) {
    throw new Error(`Enter scores of ${maximum} or less.`);
  }
  return scores;
}

function applyCornhole(state, action, target) {
  if (action.type === 'frame') {
    const [home, away] = validateScores(action, CORNHOLE_MAX_FRAME);
    state.scores[0] += Math.max(0, home - away);
    state.scores[1] += Math.max(0, away - home);
  } else if (action.type === 'result') {
    const [home, away] = validateScores(action, target + CORNHOLE_MAX_FRAME - 1);
    if ((home >= target) === (away >= target)) {
      throw new Error(`One team must finish at ${target} or higher and the other below ${target}.`);
    }
    state.scores = [home, away];
  } else {
    throw new Error('Enter a cornhole frame or final score.');
  }

  state.winner = SIDES[state.scores.findIndex(score => score >= target)] ?? null;
}

function applyCricket(state, action) {
  if (action.type === 'result') {
    const winner = SIDES.indexOf(action.winner);
    const scores = validateScores(action);
    if (winner < 0 || scores[winner] < scores[1 - winner]) {
      throw new Error('Choose a winner with at least as many points as the other team.');
    }
    state.scores = scores;
    state.winner = action.winner;
    return;
  }

  const side = SIDES.indexOf(action.side);
  const { target, multiplier } = action;
  const maxMultiplier = target === TARGETS.length - 1 ? 2 : 3;
  if (action.type !== 'hit' || side < 0 || !Number.isInteger(target) || target < 0 || target >= TARGETS.length
    || !Number.isInteger(multiplier) || multiplier < 1 || multiplier > maxMultiplier) {
    throw new Error('Choose a team, a cricket target, and a valid hit.');
  }

  const opponent = 1 - side;
  const marks = state.marks[side][target] + multiplier;
  state.marks[side][target] = Math.min(3, marks);
  if (marks > 3 && state.marks[opponent][target] < 3) {
    state.scores[side] += (marks - 3) * TARGET_VALUES[target];
    if (!Number.isSafeInteger(state.scores[side])) throw new Error('Score exceeds the supported range.');
  }
  if (state.marks[side].every(count => count === 3) && state.scores[side] >= state.scores[opponent]) {
    state.winner = SIDES[side];
  }
}

function applyPool(state, action) {
  const winner = SIDES.indexOf(action.winner);
  if (action.type !== 'result' || winner < 0) throw new Error('Choose the winning pool team.');
  state.scores[winner] = 1;
  state.winner = action.winner;
}

const applyAction = new Map([
  ['cornhole', applyCornhole],
  ['darts', applyCricket],
  ['pool', applyPool],
]);

export function getMatchState(match, record) {
  const scoreAction = applyAction.get(match?.event);
  if (!scoreAction) throw new Error('Unknown event.');
  const actions = record == null ? [] : record.actions;
  const cornholeTarget = record?.cornholeTarget ?? CORNHOLE_TARGET;
  if (!Array.isArray(actions)) throw new Error('Match actions must be an array.');

  const state = {
    status: 'upcoming',
    scores: [0, 0],
    marks: SIDES.map(() => TARGETS.map(() => 0)),
    winner: null,
  };

  for (const action of actions) {
    if (state.winner) throw new Error('Undo the final action before adding a score to a finished match.');
    if (action == null || typeof action !== 'object' || Array.isArray(action)) {
      throw new Error('Invalid scoring action.');
    }
    scoreAction(state, action, cornholeTarget);
    state.status = state.winner ? 'final' : 'live';
  }
  return state;
}

function groupsByScore(entries, score) {
  const groups = new Map();
  for (const entry of [...entries].sort((first, second) => score(second) - score(first))) {
    const value = score(entry);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(entry);
  }
  return [...groups.values()];
}

function headToHeadCount(results) {
  const counts = new Map();
  for (const {winner, loser} of results) {
    const pair = `${winner}:${loser}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return (winner, loser) => counts.get(`${winner}:${loser}`) ?? 0;
}

function rankGroups(groups, firstRank, context) {
  const ranked = [];
  for (const group of groups) ranked.push(...rankGroup(group, firstRank + ranked.length, context));
  return ranked;
}

function rankGroup(group, rank, context) {
  if (group.length === 1) return [{ ...group[0], rank }];

  const { scope, winsAgainst, meetings, complete, decisions, tiebreaks } = context;
  const headToHead = group.map(row => {
    const team = row.team.id;
    const opponents = group.filter(peer => peer.team.id !== team);
    let wins = 0;
    let played = 0;
    for (const { team: opponent } of opponents) {
      const directWins = winsAgainst(team, opponent.id);
      wins += directWins;
      played += directWins + winsAgainst(opponent.id, team);
    }
    return { row, wins, played, complete: played === opponents.length * meetings };
  });
  if (headToHead.every(result => result.complete)
    || (meetings === null && headToHead[0].played > 0 && headToHead.every(result => result.played === headToHead[0].played))) {
    const groups = groupsByScore(headToHead, result => result.wins);
    if (groups.length > 1) return rankGroups(groups.map(places => places.map(result => result.row)), rank, context);
  }

  if (complete) {
    const teams = group.map(row => row.team);
    const id = `${scope}:${rank}:${teams.map(team => team.id).sort().join('')}`;
    const selected = group.find(row => row.team.id === decisions[id]);
    tiebreaks.push({ id, scope, rank, teams, winner: selected?.team.id ?? null });
    if (selected) {
      return [{ ...selected, rank }, ...rankGroup(group.filter(row => row !== selected), rank + 1, context)];
    }
  }
  return group.map(row => ({ ...row, rank }));
}

function eventResults(matches, records) {
  return matches.flatMap(match => {
    if (!match.home || !match.away) return [];
    const { winner } = getMatchState(match, records[match.id]);
    return winner ? [{ round: match.round, winner: match[winner], loser: winner === 'home' ? match.away : match.home }] : [];
  });
}

function standingsResult(rows, complete, tiebreaks) {
  const final = complete && tiebreaks.every(tie => tie.winner);
  const winner = complete && rows[0]?.rank === 1 && rows[1]?.rank !== 1 ? rows[0].team : null;
  return { rows, complete, final, winner };
}

function rankEvent(event, matches, results, teams, decisions, tiebreaks) {
  const rows = teams.map(team => ({ team, wins: 0, losses: 0, finish: 4 }));
  const rowsByTeam = new Map(rows.map(row => [row.team.id, row]));
  for (const { round, winner, loser } of results) {
    rowsByTeam.get(winner).wins++;
    rowsByTeam.get(loser).losses++;
    rowsByTeam.get(loser).finish = round;
  }

  const complete = matches.length > 0 && results.length === matches.length;
  const ranked = rankGroups(groupsByScore(rows, row => row.finish), 1, {
    scope: event, winsAgainst: headToHeadCount(results), meetings: 1, complete, decisions, tiebreaks,
  });
  const standings = standingsResult(ranked, complete, tiebreaks);
  const placeCounts = new Map();
  for (const { rank } of ranked) placeCounts.set(rank, (placeCounts.get(rank) ?? 0) + 1);
  standings.rows = ranked.map(row => {
    const places = placeCounts.get(row.rank);
    // Estimate tied places by sharing their points until the mini-game resolves them.
    const combined = Array.from({ length: places }, (_, index) => PLACEMENT_POINTS[row.rank - 1 + index] ?? 0)
      .reduce((total, points) => total + points, 0);
    return { ...row, points: results.length ? combined / places : null };
  });
  return standings;
}

export function getStandings(event, records = {}, teams = TEAMS) {
  const matches = getMatches(teams.length, records).filter(match => match.event === event);
  return rankEvent(event, matches, eventResults(matches, records), teams, {}, []).rows;
}

export function getTournamentStandings(records = {}, teams = TEAMS, tiebreaks = {}) {
  const matches = getMatches(teams.length, records);
  const matchesByEvent = EVENTS.map(({ id }) => matches.filter(match => match.event === id));
  const results = matchesByEvent.map(fixtures => eventResults(fixtures, records));
  const activeTies = [];
  const events = Object.fromEntries(EVENTS.map(({ id }, index) => {
    const ties = [];
    const event = rankEvent(id, matchesByEvent[index], results[index], teams, tiebreaks, ties);
    activeTies.push(...ties);
    return [id, event];
  }));

  const rows = teams.map(team => {
    const placements = Object.fromEntries(EVENTS.map(({ id }) => [
      id, events[id].rows.find(row => row.team.id === team.id).points,
    ]));
    const points = Object.values(placements).reduce((total, value) => total + (value ?? 0), 0);
    return { team, points, events: placements };
  });
  const complete = EVENTS.every(({ id }) => events[id].final);
  const overallTies = [];
  const ranked = rankGroups(groupsByScore(rows, row => row.points), 1, {
    scope: 'overall', winsAgainst: headToHeadCount(results.flat()), meetings: null,
    complete, decisions: tiebreaks, tiebreaks: overallTies,
  });
  return { events, overall: standingsResult(ranked, complete, overallTies), tiebreaks: [...activeTies, ...overallTies] };
}
