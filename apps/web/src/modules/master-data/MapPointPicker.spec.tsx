import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapPointPicker } from './MapPointPicker';

/**
 * The zoom buttons sit on top of the map, inside the element that turns a press into a picked point. Until the
 * frame learned to ignore presses that begin on a control, clicking + or − did two wrong things at once: the
 * press counted as a pick, so the pin jumped to the button, and the frame's pointer capture swallowed the
 * button's own click, so the map never zoomed. Both are asserted here.
 */

// jsdom has neither layout nor these browser APIs; the component only needs them not to throw.
beforeAll(() => {
  // jsdom has no PointerEvent, and without one fireEvent builds a plain Event that carries no clientX/clientY —
  // every press would land at "undefined", which reads as NaN coordinates rather than as a bug in the map.
  (globalThis as any).PointerEvent = MouseEvent;
  (globalThis as any).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
  // One frame of a real size, so tiles are laid out and a click maps to a coordinate.
  jest.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  jest.spyOn(HTMLDivElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 300, width: 600, height: 300, toJSON: () => ({}),
  } as DOMRect);
});

const frameOf = (container: HTMLElement) => container.querySelector('[data-map-picker]') as HTMLElement;
const tileZoom = (container: HTMLElement) => {
  const src = container.querySelector('img')?.getAttribute('src') ?? '';
  return Number(/openstreetmap\.org\/(\d+)\//.exec(src)?.[1]);
};

function press(target: Element, { x, y }: { x: number; y: number }) {
  fireEvent.pointerDown(target, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: x, clientY: y });
}

describe('MapPointPicker', () => {
  it('picks the point that was clicked on the map', () => {
    const onPick = jest.fn();
    const { container } = render(<MapPointPicker latitude={null} longitude={null} onPick={onPick} />);
    press(frameOf(container), { x: 300, y: 150 });
    expect(onPick).toHaveBeenCalledTimes(1);
    const [lat, lng] = onPick.mock.calls[0];
    expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(lng)).toBeLessThanOrEqual(180);
  });

  it('treats a press that moved as a pan, not a pick', () => {
    const onPick = jest.fn();
    const { container } = render(<MapPointPicker latitude={null} longitude={null} onPick={onPick} />);
    const frame = frameOf(container);
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 220, clientY: 110 });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 220, clientY: 110 });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('zooms in and out on the buttons without moving the point', () => {
    const onPick = jest.fn();
    const { container } = render(<MapPointPicker latitude={-17.8252} longitude={31.0335} onPick={onPick} />);
    const start = tileZoom(container);

    fireEvent.click(screen.getByLabelText('Zoom in'));
    const zoomedIn = tileZoom(container);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    const zoomedOut = tileZoom(container);

    expect(zoomedIn).toBe(start + 1);
    expect(zoomedOut).toBe(start);
    // The point is the caller's; a zoom must never rewrite it.
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not pick when the press begins on a control', () => {
    const onPick = jest.fn();
    render(<MapPointPicker latitude={-17.8252} longitude={31.0335} onPick={onPick} />);
    press(screen.getByLabelText('Zoom in'), { x: 580, y: 20 });
    press(screen.getByLabelText('Zoom out'), { x: 580, y: 50 });
    press(screen.getByLabelText('Centre on the point'), { x: 580, y: 80 });
    expect(onPick).not.toHaveBeenCalled();
  });

  // Panning moves the view away from the point; this brings it back without touching the value or the zoom.
  it('centres the view back on the point, leaving the point and the zoom alone', () => {
    const onPick = jest.fn();
    const { container } = render(<MapPointPicker latitude={-17.8252} longitude={31.0335} onPick={onPick} />);
    const frame = frameOf(container);
    const zoomBefore = tileZoom(container);
    const pinBefore = container.querySelector('.-translate-y-full')?.getAttribute('style');

    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 80, clientY: 40 });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 80, clientY: 40 });
    expect(container.querySelector('.-translate-y-full')?.getAttribute('style')).not.toBe(pinBefore);

    fireEvent.click(screen.getByLabelText('Centre on the point'));
    // Back in the middle of a 600 x 300 frame, at the same zoom, with the value untouched.
    const style = container.querySelector('.-translate-y-full')?.getAttribute('style') ?? '';
    expect(style).toContain('left: 300px');
    expect(style).toContain('top: 150px');
    expect(tileZoom(container)).toBe(zoomBefore);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('offers no centring when there is no point yet', () => {
    render(<MapPointPicker latitude={null} longitude={null} onPick={jest.fn()} />);
    expect((screen.getByLabelText('Centre on the point') as HTMLButtonElement).disabled).toBe(true);
  });
});
