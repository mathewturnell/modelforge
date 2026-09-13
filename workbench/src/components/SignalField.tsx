import {useEffect, useRef} from "react";

export function SignalField({className = ""}: {className?: string}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let handle = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(box.width * ratio));
      canvas.height = Math.max(1, Math.floor(box.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const render = () => {
      const {width, height} = canvas.getBoundingClientRect();
      context.clearRect(0, 0, width, height);
      const time = reduceMotion ? 1.4 : frame / 70;
      const columns = 34;
      const rows = 18;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const nx = column / (columns - 1);
          const ny = row / (rows - 1);
          const perspective = .38 + ny * .82;
          const wave = Math.sin(nx * 10 + time) * Math.cos(ny * 8 - time * .7);
          const focus = Math.exp(-((nx - .62) ** 2 + (ny - .46) ** 2) * 12);
          const x = width * (.04 + nx * .92) + wave * 5 * perspective;
          const y = height * (.18 + ny * .72) - (wave * 12 + focus * 30) * perspective;
          const alpha = .08 + focus * .62 + ny * .08;
          const radius = .65 + perspective * .7 + focus * 1.6;
          context.beginPath();
          context.fillStyle = focus > .24 ? `rgba(118,185,0,${alpha})` : `rgba(177,184,194,${alpha})`;
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
      frame += 1;
      if (!reduceMotion) handle = requestAnimationFrame(render);
    };
    resize();
    render();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => { observer.disconnect(); cancelAnimationFrame(handle); };
  }, []);

  return <canvas ref={canvasRef} className={`signal-field ${className}`} aria-hidden="true" />;
}
