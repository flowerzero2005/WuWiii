import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { StageEnvironment } from '@proj-airi/stage-shared'
import {
  beatSyncBeatSignaledInvokeEventa,
  beatSyncGetInputByteFrequencyDataInvokeEventa,
  beatSyncGetStateInvokeEventa,
  beatSyncStateChangedInvokeEventa,
  beatSyncToggleInvokeEventa,
  beatSyncUpdateParametersInvokeEventa,
  createBeatSyncDetector,
  createContext,
} from '@proj-airi/stage-shared/beat-sync'

const context = createContext()

const changeState = defineInvoke(context, beatSyncStateChangedInvokeEventa)
const signalBeat = defineInvoke(context, beatSyncBeatSignaledInvokeEventa)

const detector = createBeatSyncDetector({
  env: StageEnvironment.Tamagotchi,
})

detector.on('stateChange', state => changeState(state))
detector.on('beat', (e) => {
  signalBeat(e)
})

defineInvokeHandler(context, beatSyncToggleInvokeEventa, async (enabled) => {
  if (enabled) {
    detector.startScreenCapture()
  }
  else {
    detector.stop()
  }
})
defineInvokeHandler(context, beatSyncGetStateInvokeEventa, async () => detector.state)
defineInvokeHandler(context, beatSyncUpdateParametersInvokeEventa, async (params) => {
  detector.updateParameters(params)
})
defineInvokeHandler(context, beatSyncGetInputByteFrequencyDataInvokeEventa, async () => {
  return detector.getInputByteFrequencyData()
})
