import { captureContext } from './context.js'
import { captureScreenshot } from './screenshot.js'
import cssText from './styles.css?inline'

const BUG_CATEGORIES = [
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
    this._type = 'bug'
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

    this._trigger = document.createElement('button')
    this._trigger.className = `bp-trigger bp-trigger--${pos}`
    this._trigger.setAttribute('aria-label', 'Open feedback form')
    this._trigger.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      ${this._cfg.triggerLabel}
    `

    this._backdrop = document.createElement('div')
    this._backdrop.className = 'bp-backdrop'
    this._backdrop.setAttribute('aria-hidden', 'true')

    this._dialog = document.createElement('div')
    this._dialog.className = `bp-dialog bp-dialog--${pos}`
    this._dialog.setAttribute('role', 'dialog')
    this._dialog.setAttribute('aria-modal', 'true')
    this._dialog.setAttribute('aria-labelledby', 'bp-dialog-title')
    this._dialog.innerHTML = this._dialogHTML()

    document.body.appendChild(this._backdrop)
    document.body.appendChild(this._dialog)
    document.body.appendChild(this._trigger)

    // Bug field refs
    this._bugCategoryEl  = this._dialog.querySelector('#bp-bug-category')
    this._whatHappenedEl = this._dialog.querySelector('#bp-what-happened')
    this._expectedEl     = this._dialog.querySelector('#bp-expected')
    this._stepsEl        = this._dialog.querySelector('#bp-steps')
    this._frequencyEl    = this._dialog.querySelector('#bp-frequency')
    this._impactEl       = this._dialog.querySelector('#bp-impact')
    // Feature field refs
    this._featureAskEl      = this._dialog.querySelector('#bp-feature-ask')
    this._featureWhyEl      = this._dialog.querySelector('#bp-feature-why')
    this._featurePriorityEl = this._dialog.querySelector('#bp-feature-priority')
    // Common refs
    this._screenshotPreview = this._dialog.querySelector('#bp-screenshot-preview')
    this._captureBtn        = this._dialog.querySelector('#bp-capture-btn')
    this._submitBtn         = this._dialog.querySelector('#bp-submit-btn')
    this._statusEl          = this._dialog.querySelector('#bp-status')

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
        <div class="bp-type-picker">
          <button class="bp-type-btn bp-type-btn--active" data-type="bug" type="button">Bug / Usability</button>
          <button class="bp-type-btn" data-type="feature" type="button">Feature / Feedback</button>
        </div>

        <div id="bp-fields-bug">
          <div class="bp-field">
            <label class="bp-label" for="bp-bug-category">Category</label>
            <select class="bp-select" id="bp-bug-category">
              <option value="">Select a category…</option>
              ${BUG_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="bp-what-happened">What happened? <span>(required)</span></label>
            <textarea class="bp-textarea" id="bp-what-happened" placeholder="Describe what went wrong. What did you see?" rows="3"></textarea>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="bp-expected">Expected behaviour <span>(required)</span></label>
            <textarea class="bp-textarea" id="bp-expected" placeholder="What should have happened instead?" rows="2"></textarea>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="bp-steps">Steps to reproduce <span>(optional)</span></label>
            <textarea class="bp-textarea" id="bp-steps" placeholder="1. Go to…&#10;2. Click…&#10;3. See error" rows="3"></textarea>
          </div>
          <div class="bp-field-row">
            <div class="bp-field">
              <label class="bp-label" for="bp-frequency">How often?</label>
              <select class="bp-select" id="bp-frequency">
                <option value="every-time">Every time</option>
                <option value="most-times">Most of the time</option>
                <option value="sometimes">Occasionally</option>
                <option value="once">Just once</option>
              </select>
            </div>
            <div class="bp-field">
              <label class="bp-label" for="bp-impact">Impact</label>
              <select class="bp-select" id="bp-impact">
                <option value="blocking">Blocking</option>
                <option value="degraded">Degraded</option>
                <option value="cosmetic">Cosmetic</option>
              </select>
            </div>
          </div>
        </div>

        <div id="bp-fields-feature" class="bp-fields--hidden">
          <div class="bp-field">
            <label class="bp-label" for="bp-feature-ask">What would you like? <span>(required)</span></label>
            <textarea class="bp-textarea" id="bp-feature-ask" placeholder="Describe the feature or improvement you'd like to see." rows="3"></textarea>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="bp-feature-why">Why do you need it? <span>(optional)</span></label>
            <textarea class="bp-textarea" id="bp-feature-why" placeholder="What problem does this solve? Who else would benefit?" rows="2"></textarea>
          </div>
          <div class="bp-field">
            <label class="bp-label" for="bp-feature-priority">Priority to you</label>
            <select class="bp-select" id="bp-feature-priority">
              <option value="critical">Critical to my workflow</option>
              <option value="high">Would significantly help</option>
              <option value="nice">Nice to have</option>
            </select>
          </div>
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
    chips.textContent = ''
    fields.forEach((f) => {
      const span = document.createElement('span')
      span.className = 'bp-chip'
      span.textContent = f
      chips.appendChild(span)
    })
  }

  _onTypeChange(type) {
    this._type = type
    this._dialog.querySelector('#bp-dialog-title').textContent =
      type === 'bug' ? 'Report a bug' : 'Feature / Feedback'
    this._dialog.querySelectorAll('.bp-type-btn').forEach((btn) => {
      btn.classList.toggle('bp-type-btn--active', btn.dataset.type === type)
    })
    this._dialog.querySelector('#bp-fields-bug').classList.toggle('bp-fields--hidden', type !== 'bug')
    this._dialog.querySelector('#bp-fields-feature').classList.toggle('bp-fields--hidden', type !== 'feature')
    this._updateSubmit()
  }

  _bind() {
    this._trigger.addEventListener('click', () => this.open())
    this._dialog.querySelector('#bp-close-btn').addEventListener('click', () => this.close())
    this._backdrop.addEventListener('click', () => this.close())

    this._dialog.querySelectorAll('.bp-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => this._onTypeChange(btn.dataset.type))
    })

    this._whatHappenedEl.addEventListener('input', () => this._updateSubmit())
    this._expectedEl.addEventListener('input', () => this._updateSubmit())
    this._featureAskEl.addEventListener('input', () => this._updateSubmit())

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
    let ready
    if (this._type === 'bug') {
      ready = this._whatHappenedEl.value.trim().length > 0 && this._expectedEl.value.trim().length > 0
    } else {
      ready = this._featureAskEl.value.trim().length > 0
    }
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
    const base = {
      type: this._type,
      screenshot: this._screenshot,
      context: ctx,
      projectName: this._cfg.projectName || document.title,
    }

    const payload = this._type === 'bug'
      ? {
          ...base,
          description: this._whatHappenedEl.value.trim(),
          bugCategory: this._bugCategoryEl.value || null,
          expectedBehavior: this._expectedEl.value.trim(),
          stepsToReproduce: this._stepsEl.value.trim() || null,
          frequency: this._frequencyEl.value,
          impact: this._impactEl.value,
        }
      : {
          ...base,
          description: this._featureAskEl.value.trim(),
          problemStatement: this._featureWhyEl.value.trim() || null,
          priority: this._featurePriorityEl.value,
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
    this._bugCategoryEl.value = ''
    this._whatHappenedEl.value = ''
    this._expectedEl.value = ''
    this._stepsEl.value = ''
    this._frequencyEl.value = 'every-time'
    this._impactEl.value = 'blocking'
    this._featureAskEl.value = ''
    this._featureWhyEl.value = ''
    this._featurePriorityEl.value = 'critical'
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
    const firstField = this._type === 'bug' ? this._whatHappenedEl : this._featureAskEl
    firstField.focus()
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
