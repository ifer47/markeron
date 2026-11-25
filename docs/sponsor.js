;(function () {
  const IMG_SRC = 'assets/sponsor-pay.png'

  const COPY = {
    en: {
      title: 'WeChat / Alipay QR',
      close: 'Close',
      tiersTitle: 'Sponsorship tiers (4)',
      tiers: [
        { key: 'supporter', name: 'Supporter', desc: 'Any amount or one-time' },
        { key: 'patron', name: 'Patron', desc: 'Cumulative ¥50+ or 3 months' },
        { key: 'guardian', name: 'Guardian', desc: 'Cumulative ¥200+ or 12 months' },
        { key: 'contributor', name: 'Co-creator', desc: 'Code / docs / design' },
      ],
      tiersNote: 'Tiers only change the badge in the in-app credits list. Amounts are guidelines.',
    },
    'zh-CN': {
      title: '微信 / 支付宝收款码',
      close: '关闭',
      tiersTitle: '赞助档位（4 档）',
      tiers: [
        { key: 'supporter', name: '支持者', desc: '任意金额 / 一次性' },
        { key: 'patron', name: '同行者', desc: '累计 ≥ ¥50 或连续 3 个月' },
        { key: 'guardian', name: '守护者', desc: '累计 ≥ ¥200 或连续 12 个月' },
        { key: 'contributor', name: '共创者', desc: '代码 / 文档 / 设计等' },
      ],
      tiersNote: '档位只影响应用内致谢名单的标签，金额与时长仅供参考。',
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
      '<div class="sponsor-modal__scroll">' +
      '<img class="sponsor-modal__img" src="' +
      IMG_SRC +
      '" alt="" width="1353" height="849" decoding="async" />' +
      '<div class="sponsor-modal__tiers">' +
      '<details class="sponsor-modal__tier-details">' +
      '<summary class="sponsor-modal__tiers-title" data-tier-title></summary>' +
      '<ul class="sponsor-modal__tier-list" data-tier-list></ul>' +
      '<p class="sponsor-modal__tiers-note" data-tier-note></p>' +
      '</details>' +
      '</div>' +
      '</div>' +
      '</div>'

    document.body.appendChild(modal)

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-sponsor-close]')) {
        closeModal()
      }
    })

    return modal
  }

  function renderTiers(list, tiers) {
    list.textContent = ''
    for (const tier of tiers) {
      const item = document.createElement('li')
      item.className = 'sponsor-modal__tier sponsor-modal__tier--' + tier.key

      const name = document.createElement('span')
      name.className = 'sponsor-modal__tier-name'
      name.textContent = tier.name

      const desc = document.createElement('span')
      desc.className = 'sponsor-modal__tier-desc'
      desc.textContent = tier.desc

      item.append(name, desc)
      list.append(item)
    }
  }

  function syncCopy() {
    if (!modal) return
    const text = copy()
    const dialog = modal.querySelector('[role="dialog"]')
    const closeBtn = modal.querySelector('.sponsor-modal__close')
    const img = modal.querySelector('.sponsor-modal__img')
    const tiersTitle = modal.querySelector('[data-tier-title]')
    const tierList = modal.querySelector('[data-tier-list]')
    const tiersNote = modal.querySelector('[data-tier-note]')
    if (dialog) dialog.setAttribute('aria-label', text.title)
    if (closeBtn) {
      closeBtn.setAttribute('aria-label', text.close)
      closeBtn.textContent = '×'
    }
    if (img) img.setAttribute('alt', text.title)
    if (tiersTitle) tiersTitle.textContent = text.tiersTitle
    if (tierList) renderTiers(tierList, text.tiers)
    if (tiersNote) tiersNote.textContent = text.tiersNote
  }

  function openModal() {
    const root = ensureModal()
    clearCloseTimer()
    openGeneration += 1
    syncCopy()
    // Always start collapsed so the QR stays the focus of the dialog.
    const tierDetails = root.querySelector('.sponsor-modal__tier-details')
    if (tierDetails) tierDetails.open = false
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
