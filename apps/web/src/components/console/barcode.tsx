'use client';

import { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * A Code 128 barcode of `value`, drawn into an SVG. Black on white whatever the theme, so it scans off a screen too.
 * Code 128 carries ASCII only; a value outside it shows `fallback` instead.
 */
export function Barcode({
  value,
  svgRef,
  height = 64,
  className = 'h-14 w-full max-w-full',
}: {
  value: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  height?: number;
  className?: string;
}) {
  const [node, setNode] = useState<SVGSVGElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!node || !value) return;
    try {
      JsBarcode(node, value, {
        format: 'CODE128',
        width: 2,
        height,
        margin: 0,
        displayValue: false,
        background: '#ffffff',
        lineColor: '#000000',
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [node, value, height]);
  return (
    <>
      <svg
        ref={(el) => {
          setNode(el);
          if (svgRef) svgRef.current = el;
        }}
        data-barcode
        role="img"
        aria-label={`Barcode ${value}`}
        className={failed ? 'hidden' : className}
        preserveAspectRatio="none"
      />
      {failed && <p className="text-xs text-[#555]">This code cannot be drawn as a barcode.</p>}
    </>
  );
}
