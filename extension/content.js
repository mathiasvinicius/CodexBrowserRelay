function selectOne(selector) {
  if (typeof selector !== 'string' || !selector.trim()) {
    throw new Error('selector is required')
  }
  const el = document.querySelector(selector)
  if (!el) {
    throw new Error(`selector not found: ${selector}`)
  }
  return el
}

function elementSummary(el) {
  return {
    tagName: el.tagName || '',
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className : '',
    text: (el.innerText || el.textContent || '').slice(0, 500),
    value: 'value' in el ? String(el.value ?? '') : '',
  }
}

function elementDetail(el) {
  return {
    ...elementSummary(el),
    ariaLabel: el.getAttribute?.('aria-label') || '',
    role: el.getAttribute?.('role') || '',
    dataTestId: el.getAttribute?.('data-testid') || '',
    type: el.getAttribute?.('type') || '',
    name: el.getAttribute?.('name') || '',
    placeholder: el.getAttribute?.('placeholder') || '',
    disabled: Boolean(el.disabled),
  }
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isInteractableElement(el) {
  if (!(el instanceof Element)) return false
  if (el instanceof HTMLButtonElement) return true
  if (el instanceof HTMLAnchorElement) return true
  if (el instanceof HTMLInputElement) return true
  if (el instanceof HTMLTextAreaElement) return true
  if (el.getAttribute('role') === 'button') return true
  if (el.hasAttribute('tabindex')) return true
  return false
}

function findElementsByText(text, selector = 'button, [role="button"], a, div, span', exact = false) {
  const needle = normalizedText(text).toLowerCase()
  if (!needle) return []

  return Array.from(document.querySelectorAll(selector))
    .filter((el) => {
      const hay = normalizedText(el.innerText || el.textContent || el.getAttribute?.('aria-label') || '').toLowerCase()
      if (!hay) return false
      return exact ? hay === needle : hay.includes(needle)
    })
    .sort((left, right) => {
      const leftText = normalizedText(left.innerText || left.textContent || left.getAttribute?.('aria-label') || '')
      const rightText = normalizedText(right.innerText || right.textContent || right.getAttribute?.('aria-label') || '')
      const leftInteractive = isInteractableElement(left) ? 0 : 1
      const rightInteractive = isInteractableElement(right) ? 0 : 1
      if (leftInteractive !== rightInteractive) return leftInteractive - rightInteractive
      if (leftText.length !== rightText.length) return leftText.length - rightText.length
      return 0
    })
}

function setNativeValue(el, value) {
  const prototype =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null

  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null
  if (descriptor?.set) descriptor.set.call(el, value)
  else el.value = value
}

function dispatchInputEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function findSubmitCandidate(root) {
  if (!root || !(root instanceof Element)) return null
  const selectors = [
    '#composer-submit-button',
    '.composer-submit-btn',
    'button[type="submit"]',
    'button[id="composer-submit-button"]',
    'button[aria-label="Enviar"]',
    'button[aria-label="Send"]',
    'button[data-testid*="send"]',
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',
    '[data-testid="composer-send-button"]',
  ]

  for (const selector of selectors) {
    const candidate = root.querySelector(selector)
    if (candidate instanceof HTMLElement && !candidate.hasAttribute('disabled')) {
      return candidate
    }
  }

  const buttons = Array.from(root.querySelectorAll('button'))
  return (
    buttons.find(
      (button) =>
        !button.hasAttribute('disabled') &&
        button.id !== 'composer-plus-btn' &&
        button.getAttribute('aria-label') !== 'Adicionar arquivos e mais' &&
        button.getAttribute('aria-label') !== 'Botão de ditado',
    ) || null
  )
}

function getPageInfo() {
  return {
    url: location.href,
    title: document.title || '',
    readyState: document.readyState,
  }
}

async function handlePageCommand(command) {
  const action = String(command?.action || '').trim()

  switch (action) {
    case 'ping':
      return { ok: true, page: getPageInfo() }
    case 'getPageInfo':
      return { ok: true, page: getPageInfo() }
    case 'extractText': {
      const selector = command?.selector
      if (selector) {
        const el = selectOne(selector)
        return { ok: true, text: (el.innerText || el.textContent || '').trim(), element: elementSummary(el) }
      }
      return { ok: true, text: (document.body?.innerText || '').trim().slice(0, 12000), page: getPageInfo() }
    }
    case 'query': {
      const selector = String(command?.selector || '').trim()
      const nodes = selector ? Array.from(document.querySelectorAll(selector)) : []
      return {
        ok: true,
        count: nodes.length,
        matches: nodes.slice(0, 10).map((el) => elementSummary(el)),
      }
    }
    case 'queryDetailed': {
      const selector = String(command?.selector || '').trim()
      const nodes = selector ? Array.from(document.querySelectorAll(selector)) : []
      return {
        ok: true,
        count: nodes.length,
        matches: nodes.slice(0, Number(command?.limit) > 0 ? Number(command.limit) : 20).map((el) => elementDetail(el)),
      }
    }
    case 'findByText': {
      const text = String(command?.text || '').trim()
      const selector = String(command?.selector || 'button, [role="button"], a, div, span').trim()
      const exact = command?.exact === true
      const nodes = findElementsByText(text, selector, exact)
      return {
        ok: true,
        count: nodes.length,
        matches: nodes.slice(0, Number(command?.limit) > 0 ? Number(command.limit) : 20).map((el) => elementDetail(el)),
      }
    }
    case 'click': {
      const el = selectOne(command?.selector)
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      el.click()
      return { ok: true, element: elementSummary(el), page: getPageInfo() }
    }
    case 'clickText': {
      const text = String(command?.text || '').trim()
      const selector = String(command?.selector || 'button, [role="button"], a, div, span').trim()
      const exact = command?.exact === true
      const nodes = findElementsByText(text, selector, exact)
      const el = nodes[0]
      if (!el) throw new Error(`text target not found: ${text}`)
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      el.click()
      return { ok: true, element: elementDetail(el), page: getPageInfo() }
    }
    case 'type': {
      const el = selectOne(command?.selector)
      const text = String(command?.text ?? '')
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      el.focus()

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (command?.append === true) setNativeValue(el, `${el.value || ''}${text}`)
        else setNativeValue(el, text)
        dispatchInputEvents(el)
      } else if (el.isContentEditable) {
        el.textContent = command?.append === true ? `${el.textContent || ''}${text}` : text
        dispatchInputEvents(el)
      } else {
        throw new Error(`element is not typeable: ${el.tagName}`)
      }

      return { ok: true, element: elementSummary(el), page: getPageInfo() }
    }
    case 'scrollIntoView': {
      const el = selectOne(command?.selector)
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      return { ok: true, element: elementSummary(el), page: getPageInfo() }
    }
    case 'navigate': {
      const url = String(command?.url || '').trim()
      if (!url) throw new Error('url is required')
      const parsed = new URL(url, location.href)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`unsupported navigation protocol: ${parsed.protocol}`)
      }
      location.href = url
      return { ok: true, page: { ...getPageInfo(), navigatingTo: url } }
    }
    case 'pressKey': {
      const key = String(command?.key || '').trim()
      if (!key) throw new Error('key is required')
      const target = command?.selector ? selectOne(command.selector) : document.activeElement || document.body
      if (target?.focus) target.focus()
      const down = new KeyboardEvent('keydown', {
        key,
        code: key,
        keyCode: key === 'Enter' ? 13 : 0,
        which: key === 'Enter' ? 13 : 0,
        bubbles: true,
        cancelable: true,
      })
      const up = new KeyboardEvent('keyup', {
        key,
        code: key,
        keyCode: key === 'Enter' ? 13 : 0,
        which: key === 'Enter' ? 13 : 0,
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(down)
      target.dispatchEvent(up)
      return { ok: true, key, element: target ? elementDetail(target) : null, page: getPageInfo() }
    }
    case 'submitComposer': {
      const target = command?.selector ? selectOne(command.selector) : document.activeElement || document.body
      if (target?.focus) target.focus()

      /** @type {Element|null} */
      let current = target instanceof Element ? target : null
      while (current) {
        const submitButton = findSubmitCandidate(current)
        if (submitButton) {
          submitButton.click()
          return { ok: true, submittedWith: 'button', element: elementDetail(submitButton), page: getPageInfo() }
        }

        if (current instanceof HTMLFormElement) {
          current.requestSubmit()
          return { ok: true, submittedWith: 'form', page: getPageInfo() }
        }

        current = current.parentElement
      }

      throw new Error('could not find a composer submit action')
    }
    case 'waitForText': {
      const text = normalizedText(command?.text || '')
      const textGone = normalizedText(command?.textGone || '')
      if (!text && !textGone) {
        throw new Error('waitForText requires either text or textGone')
      }
      const timeoutMs = Number(command?.timeoutMs) > 0 ? Number(command.timeoutMs) : 15000
      const intervalMs = Number(command?.intervalMs) > 0 ? Number(command.intervalMs) : 300
      const started = Date.now()

      while (Date.now() - started <= timeoutMs) {
        const bodyText = normalizedText(document.body?.innerText || '')
        if (text && bodyText.includes(text)) {
          return { ok: true, matched: text, page: getPageInfo() }
        }
        if (textGone && !bodyText.includes(textGone)) {
          return { ok: true, disappeared: textGone, page: getPageInfo() }
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }

      throw new Error(text ? `timeout waiting for text: ${text}` : `timeout waiting for text to disappear: ${textGone}`)
    }
    default:
      throw new Error(`unsupported page action: ${action}`)
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined
  if (message.type !== 'PAGE_COMMAND') return undefined

  Promise.resolve(handlePageCommand(message.command))
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        page: getPageInfo(),
      }),
    )

  return true
})
