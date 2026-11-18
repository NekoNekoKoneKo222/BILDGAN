// FPS input must be finite even before the first key is pressed.
// Number(undefined) is NaN, so always normalize keyboard values to booleans.
export function readMoveAxes(keys={},stick={x:0,y:0}){
 const axis=(v)=>Number.isFinite(v)?Math.max(-1,Math.min(1,v)):0;
 const ahead=Number(Boolean(keys.KeyW||keys.ArrowUp))-
  Number(Boolean(keys.KeyS||keys.ArrowDown))-axis(stick.y);
 const sideways=Number(Boolean(keys.KeyD||keys.ArrowRight))-
  Number(Boolean(keys.KeyA||keys.ArrowLeft))+axis(stick.x);
 return {ahead,sideways};
}
