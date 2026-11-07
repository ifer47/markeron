;(function () {
  const IMG_SRC = 'assets/sponsor-pay.png'

  const COPY = {
    en: {
      title: 'WeChat / Alipay QR',
      close: 'Close',
    },
    'zh-CN': {
      title: '微信 / 支付宝收款码',
      close: '关闭',
    },
  }

  let modal = null
  let previouslyFocused = null
  let closeTimer = null
  let openGeneration = 0

  function locale() {
    const value = document.documentElement.dataset.locale
    return value === 'zh-CN' ? 'zh-CN' : 'en'
  }

  function copy() {
    return COPY[locale()]
  }

  function clearCloseTimer() {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  function ensureModal() {
    if (modal) return modal

    modal = document.createElement('div')
    modal.id = 'sponsor-modal'
    modal.className = 'sponsor-modal'
    modal.hidden = true
    modal.innerHTML =
      '<div class="sponsor-modal__backdrop" data-sponsor-close></div>' +
      '<div class="sponsor-modal__panel" role="dialog" aria-modal="true">' +
      '<button type="button" class="sponsor-modal__close" data-sponsor-close aria-label=""></button>' +
      '<img class="sponsor-modal__img" src="' +
      IMG_SRC +
      '" alt="" width="1353" height="849" decoding="async" />' +
      '</div>'

    document.body.appendChild(modal)

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-sponsor-close]')) {
        closeModal()
      }
    })

    return modal
  }

  function syncCopy() {
    if (!modal) return
    const text = copy()
    const dialog = modal.querySelector('[role="dialog"]')
    const closeBtn = modal.querySelector('.sponsor-modal__close')
    const img = modal.querySelector('.sponsor-modal__img')
    if (dialog) dialog.setAttribute('aria-label', text.title)
    if (closeBtn) {
      closeBtn.setAttribute('aria-label', text.close)
      closeBtn.textContent = '×'
    }
    if (img) img.setAttribute('alt', text.title)
  }

  function openModal() {
    const root = ensureModal()
    clearCloseTimer()
    openGeneration += 1
    syncCopy()
    previouslyFocused = document.activeElement
    root.hidden = false
    requestAnimationFrame(() => {
      root.classList.add('is-open')
    })
    document.documentElement.classList.add('sponsor-modal-open')
    const closeBtn = root.querySelector('.sponsor-modal__close')
    closeBtn?.focus()
  }

  function closeModal() {
    if (!modal || modal.hidden) return
    const generation = openGeneration
    modal.classList.remove('is-open')
    document.documentElement.classList.remove('sponsor-modal-open')

    const finish = () => {
      closeTimer = null
      if (!modal || generation !== openGeneration) return
      modal.hidden = true
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
      previouslyFocused = null
    }

    clearCloseTimer()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
      return
    }

    closeTimer = window.setTimeout(finish, 160)
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && modal && !modal.hidden) {
      event.preventDefault()
      closeModal()
    }
  }

  function init() {
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-sponsor-open]')
      if (!trigger) return
      event.preventDefault()
      openModal()
    })

    document.addEventListener('keydown', onKeydown)

    document.querySelectorAll('[data-lang]').forEach((button) => {
      button.addEventListener('click', () => {
        if (modal && !modal.hidden) syncCopy()
      })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
