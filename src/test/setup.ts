/** Minimal Path2D stub — jsdom/node lack the Canvas Path2D API. */
class Path2DStub {
  moveTo(_x?: number, _y?: number) {}
  lineTo(_x?: number, _y?: number) {}
  quadraticCurveTo(_cpx?: number, _cpy?: number, _x?: number, _y?: number) {}
  closePath() {}
  arc(
    _x?: number,
    _y?: number,
    _radius?: number,
    _startAngle?: number,
    _endAngle?: number,
    _counterclockwise?: boolean,
  ) {}
  addPath(_path?: Path2DStub) {}
}

if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = Path2DStub as unknown as typeof Path2D
}
