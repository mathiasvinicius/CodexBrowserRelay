function setMessage(text) {
  const el = document.getElementById('message')
  if (el) el.textContent = text || ''
}

function setStatus(state) {
  const el = document.getElementById('status')
  const capture = document.getElementById('capture')
  const toggle = document.getElementById('toggle')
  if (!el || !capture || !toggle) return

  if (!state?.supported) {
    el.textContent = 'Open a normal website tab to use the relay.'
    capture.disabled = true
    toggle.disabled = true
    return
  }

  el.textContent = state.attached
    ? `Attached to: ${state.activeTitle || state.activeUrl || 'Current tab'}`
    : `Not attached. Active tab: ${state.activeTitle || state.activeUrl || 'Current tab'}`
  capture.disabled = !state.attached
  toggle.disabled = false
  toggle.textContent = state.attached ? 'Detach Current Tab' : 'Attach Current Tab'
}

async function sendPopupCommand(command) {
  const response = await chrome.runtime.sendMessage({
    type: 'POPUP_COMMAND',
    command,
  })
  if (!response?.ok) throw new Error(response?.error || `Popup command failed: ${command}`)
  return response.result
}

async function refreshState() {
  const state = await sendPopupCommand('getState')
  setStatus(state)
  return state
}

document.getElementById('toggle').addEventListener('click', async () => {
  setMessage('Working…')
  try {
    const state = await sendPopupCommand('toggleAttach')
    setStatus(state)
    setMessage(state.attached ? 'Tab attached.' : 'Tab detached.')
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

document.getElementById('capture').addEventListener('click', async () => {
  setMessage('Capturing…')
  try {
    await sendPopupCommand('captureVisible')
    await refreshState()
    setMessage('Capture requested. Choose where to save the image.')
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

void refreshState().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error))
})
