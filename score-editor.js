import { CORNHOLE_MAX_FRAME, CORNHOLE_TARGET, getLineup, getMatchState, TARGETS } from './tournament.js'

const sides = ['home', 'away']
const multipliers = ['Single', 'Double', 'Triple']

export function createScoreEditor({ match, record, draw, onSave }) {
  const editor = document.createElement('div')
  editor.className = 'score-editor'

  const cornholeTarget = record?.cornholeTarget ?? CORNHOLE_TARGET
  const teams = sides.map(side => ({
    name: `Team ${match[side]}`,
    players: getLineup(match, side, draw).join(' & '),
  }))

  const controls = document.createElement('fieldset')
  const error = document.createElement('p')
  error.className = 'score-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  const announcement = document.createElement('p')
  announcement.className = 'score-announcement'
  announcement.setAttribute('role', 'status')
  editor.append(controls, error, announcement)

  let multiplier = 1
  let entryMode = 'live'
  let saving = false

  function teamSummary(state) {
    if (match.event === 'pool' && !state.winner) return ''

    return `<div class="score-totals">
      ${teams.map((team, index) => `
        <div class="score-team ${state.winner === sides[index] ? 'is-winner' : ''}">
          <span class="score-team-name">${team.name}</span>
          <span class="score-team-players">${team.players}</span>
          <strong class="score-team-points">${match.event === 'pool'
            ? (state.winner === sides[index] ? 'Win' : 'Loss')
            : state.scores[index]}</strong>
        </div>`).join('')}
    </div>`
  }

  function pointFields(values, max) {
    return `<div class="score-fields">
      ${teams.map((team, index) => `
        <label class="score-field">
          <span>${team.name} points</span>
          <input type="number" inputmode="numeric" name="${sides[index]}"
            value="${values[index]}" min="0" ${max === undefined ? '' : `max="${max}"`}
            step="1" required id="score-${sides[index]}">
        </label>`).join('')}
    </div>`
  }

  function cornholeForm(actions) {
    return `<form data-form="frame" class="score-form">
      <div class="score-form-heading">
        <h3>Frame ${actions.length + 1}</h3>
        <p>Enter each team’s points before cancellation. First to ${cornholeTarget}+ wins.</p>
      </div>
      ${pointFields([0, 0], CORNHOLE_MAX_FRAME)}
      <button type="submit" class="score-primary" id="score-save-frame">Add frame</button>
    </form>`
  }

  function renderMarks(count) {
    return `<span aria-hidden="true" class="score-marks">
      ${Array.from({ length: 3 }, (_, index) => `<i class="${index < count ? 'filled' : ''}"></i>`).join('')}
    </span>`
  }

  function cricketBoard(state, interactive) {
    return `<table class="score-cricket">
      <caption>Cricket marks</caption>
      <thead><tr><th scope="col">${teams[0].name}</th><th scope="col">Target</th><th scope="col">${teams[1].name}</th></tr></thead>
      <tbody>${TARGETS.map((target, index) => {
        const markCells = teams.map((team, side) => {
          const count = state.marks[side][index]
          const markLabel = `${count} of 3 marks`
          if (!interactive) {
            return `<td><span class="score-announcement">${markLabel}</span>${renderMarks(count)}</td>`
          }
          const isBull = index === TARGETS.length - 1
          const disabled = isBull && multiplier === 3
          const label = `${team.name}, ${target}, ${markLabel}. Record ${multipliers[multiplier - 1].toLowerCase()} hit`
          return `<td><button type="button" class="score-hit" data-hit="${index}" data-side="${sides[side]}"
            id="score-hit-${sides[side]}-${index}" aria-label="${label}"${disabled ? ' disabled title="Bull accepts single or double hits"' : ''}>
            ${renderMarks(count)}
          </button></td>`
        })
        return `<tr>${markCells[0]}<th scope="row">${target}</th>${markCells[1]}</tr>`
      }).join('')}</tbody>
    </table>`
  }

  function cricketControls(state) {
    return `<div class="score-cricket-controls">
      <p>Choose the hit type, then tap the target for the scoring team.</p>
      <div class="score-multipliers" role="group" aria-label="Hit type">
        ${multipliers.map((label, index) => `
          <button type="button" data-multiplier="${index + 1}" id="score-multiplier-${index + 1}" aria-pressed="${multiplier === index + 1}">${label}</button>
        `).join('')}
      </div>
      ${cricketBoard(state, true)}
    </div>`
  }

  function resultForm(state) {
    const darts = match.event === 'darts'
    return `<form data-form="result" class="score-form">
      <div class="score-form-heading">
        <h3>Final result</h3>
        <p>Enter the final scores from your game.</p>
      </div>
      ${pointFields(state.scores, darts ? undefined : cornholeTarget + CORNHOLE_MAX_FRAME - 1)}
      ${darts ? `<fieldset class="score-winners"><legend>Winning team</legend>
        ${teams.map((team, index) => `
          <label><input type="radio" name="winner" value="${sides[index]}" required>${team.name}</label>
        `).join('')}
      </fieldset>` : ''}
      <button type="submit" class="score-primary" id="score-save-result">Save final result</button>
    </form>`
  }

  function poolControls() {
    return `<div class="score-pool">
      <h3>Who won?</h3>
      <div class="score-pool-options">${teams.map((team, index) => `
        <button type="button" class="score-pool-team" id="score-winner-${sides[index]}" data-winner="${sides[index]}">
          <strong>${team.name}</strong>
          <span>${team.players}</span>
        </button>`).join('')}</div>
    </div>`
  }

  function render(focusId) {
    const actions = record?.actions ?? []
    const state = getMatchState(match, record)
    const isFinal = state.status === 'final'
    const isCricket = match.event === 'darts'
    const isPool = match.event === 'pool'
    const canSwitchMode = !isFinal && !isPool
    let content

    if (isFinal) {
      const winningTeam = teams[sides.indexOf(state.winner)]
      content = `<p class="score-final">${winningTeam.name} wins</p>`
      if (isCricket && actions.at(-1)?.type === 'hit') content += cricketBoard(state, false)
    } else if (isPool) {
      content = poolControls()
    } else if (entryMode === 'result') {
      content = resultForm(state)
    } else {
      content = isCricket ? cricketControls(state) : cornholeForm(actions)
    }

    controls.innerHTML = `${teamSummary(state)}${content}
      ${canSwitchMode || actions.length ? `<div class="score-footer">
        ${canSwitchMode ? `
          <button type="button" class="score-quiet" data-mode="${entryMode === 'live' ? 'result' : 'live'}" id="score-mode">
            ${entryMode === 'live' ? 'Enter final result' : 'Back to live scoring'}
          </button>` : ''}
        ${actions.length ? `<button type="button" class="score-quiet" data-undo id="score-undo">
          ${isFinal && actions.at(-1)?.type === 'result' ? 'Undo result' : 'Undo last entry'}
        </button>` : ''}
      </div>` : ''}`

    if (focusId) {
      const target = editor.querySelector(`#${focusId}`)
        ?? controls.querySelector('input, button')
      target?.focus({ preventScroll: true })
    }
  }

  async function save(actions, focusId, undo = false) {
    if (saving) return
    error.hidden = true
    try {
      getMatchState(match, { ...record, actions })
    } catch (failure) {
      error.textContent = failure.message
      error.hidden = false
      return
    }

    saving = true
    controls.disabled = true
    editor.setAttribute('aria-busy', 'true')
    try {
      record = await onSave(actions, record?.version ?? 0)
      const addedAction = actions.at(-1)
      if (undo || addedAction?.type === 'result') entryMode = 'live'
      if (!undo && addedAction?.type === 'hit') multiplier = 1
      const state = getMatchState(match, record)
      controls.disabled = false
      render(state.status === 'final' ? 'score-undo' : focusId)
      announcement.textContent = undo
        ? 'Last entry undone.'
        : state.status === 'final' ? 'Final result saved.' : 'Score saved.'
    } catch (failure) {
      controls.disabled = false
      error.textContent = failure.message || 'Couldn’t save the score. Try again.'
      error.hidden = false
      editor.querySelector(`#${focusId}`)?.focus({ preventScroll: true })
    } finally {
      saving = false
      editor.removeAttribute('aria-busy')
    }
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('button')
    if (!button || saving) return
    const actions = record?.actions ?? []
    const action = button.dataset

    if (action.multiplier) {
      multiplier = Number(action.multiplier)
      render(button.id)
    } else if (action.hit !== undefined) {
      void save([...actions, { type: 'hit', side: action.side, target: Number(action.hit), multiplier }], button.id)
    } else if (action.winner) {
      void save([...actions, { type: 'result', winner: action.winner }], button.id)
    } else if (action.mode) {
      entryMode = action.mode
      error.hidden = true
      render(action.mode === 'result' ? 'score-home' : 'score-mode')
    } else if ('undo' in action) {
      void save(actions.slice(0, -1), button.id, true)
    }
  })

  controls.addEventListener('submit', event => {
    event.preventDefault()
    if (saving) return
    const form = event.target
    const data = new FormData(form)
    const action = {
      type: form.dataset.form,
      home: Number(data.get('home')),
      away: Number(data.get('away')),
    }
    if (data.has('winner')) action.winner = data.get('winner')
    void save([...(record?.actions ?? []), action], 'score-home')
  })

  controls.addEventListener('focusin', event => {
    if (event.target.type === 'number') event.target.select()
  })

  render()
  return editor
}
