import { captureContext } from './context.js'
import { captureScreenshot } from './screenshot.js'
import cssText from './styles.css?inline'

const CATEGORIES = [
  'UI / Visual issue',
  'Functionality bug',
  'Performance issue',
  'Navigation problem',
  'Data display error',
  'Form / input issue',
  'Other',
]

export class BugPilotWidget {
  constructor(config) {
    this._cfg = {
      position: 'bottom-right',
      triggerLabel: 'Feedback',
      ...config,
    }
    this._screenshot = null
    this._submitting = false
    this._inject()
    this._render()
    this._bind()
  }

  _inject() {
    if (document.getElementById('bp-styles')) return
    const style = document.createElement('style')
    style.id = 'bp-styles'
    style.textContent = cssText
    document.head.appendChild(style)
  }

  _render() {
    const pos = this._cfg.position

    // Trigger button
    this._trigger = document.createElement('button')
    this._trigger.className = `bp-trigger bp-trigger--${pos}`
    this._trigger.setAttribute('aria-label', 'Open feedback form')
    this._trigger.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      ${this._cfg.triggerLabel}
    `

    // Backdrop
    this._backdrop = document.createElement('div')
    this._backdrop.className = 'bp-backdrop'
    this._backdrop.setAttribute('aria-hidden', 'true')

    // Dialog
    this._dialog = document.createElement('div')
    this._dialog.className = `bp-dialog bp-dialog--${pos}`
    this._dialog.setAttribute('role', 'dialog')
    this._dialog.setAttribute('aria-modal', 'true')
    this._dialog.setAttribute('aria-labelledby', 'bp-dialog-title')
    this._dialog.innerHTML = this._dialogHTML()

    document.body.appendChild(this._backdrop)
    document.body.appendChild(this._dialog)
    document.body.appendChild(this._trigger)

    // Named refs into the dialog
    this._categoryEl = this._dialog.querySelector('#bp-category')
    this._descriptionEl = this._dialog.querySelector('#bp-description')
    this._screenshotPreview = this._dialog.querySelector('#bp-screenshot-preview')
    this._captureBtn = this._dialog.querySelector('#bp-capture-btn')
    this._submitBtn = this._dialog.querySelector('#bp-submit-btn')
    this._statusEl = this._dialog.querySelector('#bp-status')

    this._populateContext()
  }

  _dialogHTML() {
    return `
      <div class="bp-header">
        <h2 id="bp-dialog-title">Report a bug</h2>
        <button class="bp-close" id="bp-close-btn" aria-label="Close feedback form">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="bp-body">
        <div class="bp-field">
          <label class="bp-label" for="bp-category">Category</label>
          <select class="bp-select" id="bp-category">
            <option value="">Select a category…</option>
            ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="bp-field">
          <label class="bp-label" for="bp-description">Description <span>(required)</span></label>
          <textarea class="bp-textarea" id="bp-description" placeholder="What went wrong? What did you expect to happen?" rows="4"></textarea>
        </div>
        <div class="bp-field">
          <span class="bp-label">Screenshot <span>(optional)</span></span>
          <div class="bp-screenshot-row">
            <button class="bp-btn-ghost" id="bp-capture-btn" type="button">Capture screenshot</button>
          </div>
          <img class="bp-screenshot-preview" id="bp-screenshot-preview" alt="Screenshot preview" />
        </div>
        <div class="bp-field">
          <span class="bp-label">Context</span>
          <div class="bp-context" id="bp-context-chips"></div>
        </div>
        <div class="bp-status" id="bp-status" role="alert"></div>
      </div>
      <div class="bp-footer">
        <button class="bp-btn-primary" id="bp-submit-btn" type="button" disabled>Submit report</button>
      </div>
    `
  }

  _populateContext() {
    const ctx = captureContext()
    const chips = this._dialog.querySelector('#bp-context-chips')
    const fields = [
      ctx.browser,
      ctx.os,
      `${ctx.viewport.w}×${ctx.viewport.h}`,
      new URL(ctx.url).pathname,
    ]
    chips.innerHTML = fields.map((f) => `<span class="bp-chip">${f}</span>`).join('')
  }

  _bind() {
    this._trigger.addEventListener('click', () => this.open())
    this._dialog.querySelector('#bp-close-btn').addEventListener('click', () => this.close())
    this._backdrop.addEventListener('click', () => this.close())

    this._descriptionEl.addEventListener('input', () => this._updateSubmit())
    this._categoryEl.addEventListener('change', () => this._updateSubmit())

    this._captureBtn.addEventListener('click', async () => {
      this._captureBtn.disabled = true
      this._captureBtn.textContent = 'Capturing…'
      try {
        this._screenshot = await captureScreenshot([
          this._dialog,
          this._backdrop,
          this._trigger,
        ])
        this._screenshotPreview.src = this._screenshot
        this._screenshotPreview.classList.add('bp-visible')
        this._captureBtn.textContent = 'Retake screenshot'
      } catch (err) {
        this._captureBtn.textContent = 'Capture failed — retry'
        console.error('[bugpilot] screenshot capture failed', err)
      } finally {
        this._captureBtn.disabled = false
      }
    })

    this._submitBtn.addEventListener('click', () => this._submit())

    this._onKeydown = (e) => { if (e.key === 'Escape' && this._isOpen) this.close() }
    document.addEventListener('keydown', this._onKeydown)
  }

  _updateSubmit() {
    const ready = this._descriptionEl.value.trim().length > 0
    this._submitBtn.disabled = !ready || this._submitting
  }

  async _submit() {
    if (this._submitting) return
    this._submitting = true
    this._submitBtn.disabled = true
    this._submitBtn.textContent = 'Sending…'
    this._statusEl.className = 'bp-status'
    this._statusEl.textContent = ''

    const ctx = captureContext()
    const payload = {
      category: this._categoryEl.value || null,
      description: this._descriptionEl.value.trim(),
      screenshot: this._screenshot,
      context: ctx,
      projectName: this._cfg.projectName || document.title,
      labels: this._cfg.labels || [],
    }

    try {
      const res = await fetch(this._cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const { issueUrl } = await res.json()
      this._showStatus('success', issueUrl && /^https:\/\/github\.com\//.test(issueUrl) ? issueUrl : null)
      this._reset()
      setTimeout(() => this.close(), 3000)
    } catch (err) {
      this._showError(`Failed to submit: ${err.message}`)
      console.error('[bugpilot] submit failed', err)
    } finally {
      this._submitting = false
      this._submitBtn.textContent = 'Submit report'
      this._updateSubmit()
    }
  }

  _showStatus(type, issueUrl) {
    this._statusEl.className = `bp-status bp-status--${type} bp-visible`
    this._statusEl.textContent = ''
    const msg = document.createTextNode('Report submitted. ')
    this._statusEl.appendChild(msg)
    if (issueUrl) {
      const a = document.createElement('a')
      a.href = issueUrl
      a.textContent = 'View issue →'
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      this._statusEl.appendChild(a)
    }
  }

  _showError(message) {
    this._statusEl.className = 'bp-status bp-status--error bp-visible'
    this._statusEl.textContent = message
  }

  _reset() {
    this._categoryEl.value = ''
    this._descriptionEl.value = ''
    this._screenshot = null
    this._screenshotPreview.src = ''
    this._screenshotPreview.classList.remove('bp-visible')
    this._captureBtn.textContent = 'Capture screenshot'
    this._updateSubmit()
  }

  open() {
    this._isOpen = true
    this._dialog.classList.add('bp-visible')
    this._backdrop.classList.add('bp-visible')
    this._descriptionEl.focus()
  }

  close() {
    this._isOpen = false
    this._dialog.classList.remove('bp-visible')
    this._backdrop.classList.remove('bp-visible')
    this._statusEl.className = 'bp-status'
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeydown)
    this._trigger?.remove()
    this._dialog?.remove()
    this._backdrop?.remove()
    document.getElementById('bp-styles')?.remove()
  }
}
