import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

// React's act() warns unless the environment declares itself an act environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
