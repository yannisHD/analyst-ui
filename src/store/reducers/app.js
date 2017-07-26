import { SET_ANALYSIS_MODE, CLEAR_ANALYSIS_MODE } from '../actions'

const initialState = {
  analysisMode: null
}

const app = (state = initialState, action) => {
  switch (action.type) {
    case SET_ANALYSIS_MODE:
      return {
        ...state,
        analysisMode: action.mode
      }
    case CLEAR_ANALYSIS_MODE:
      return {
        ...state,
        analysisMode: null
      }
    default:
      return state
  }
}

export default app
