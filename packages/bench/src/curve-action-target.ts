// The curve recorder and the predictor must derive the same value-free key, so
// the derivation lives in @rote/predictor; these names stay exported for callers.
export { actionTarget as curveActionTarget, type ActionLike as CurveActionLike } from '@rote/predictor';
