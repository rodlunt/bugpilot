import { BugPilotWidget } from './widget.js'

let _instance = null

const BugPilot = {
  init(config) {
    if (_instance) {
      console.warn('[bugpilot] already initialised — call BugPilot.destroy() first to re-init')
      return _instance
    }
    if (!config?.endpoint) {
      throw new Error('[bugpilot] config.endpoint is required')
    }
    _instance = new BugPilotWidget(config)
    return _instance
  },

  open() {
    _instance?.open()
  },

  close() {
    _instance?.close()
  },

  destroy() {
    _instance?.destroy()
    _instance = null
  },
}

export default BugPilot
