import {useEffect, useRef} from "react";

export function PointCloudWave({className = ""}: {className?: string}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;
    let previousFrame = -Infinity;
    let running = !window.IntersectionObserver;

    const resize = () => {
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (timestamp = 0) => {
      if (!running) { animationFrame = 0; return; }
      if (!reducedMotion && timestamp - previousFrame < 32) {
        animationFrame = window.requestAnimationFrame(draw);
        return;
      }
      previousFrame = timestamp;
      if (canvas.width !== Math.round(canvas.clientWidth * pixelRatio) || canvas.height !== Math.round(canvas.clientHeight * pixelRatio)) resize();
      context.clearRect(0, 0, width, height);

      const phase = timestamp * .00024;
      const columns = Math.max(44, Math.min(82, Math.round(width / 18)));
      const rows = 25;
      for (let row = rows - 1; row >= 0; row -= 1) {
        const depth = row / (rows - 1);
        const perspective = .28 + (1 - depth) * .72;
        const horizonFade = Math.sin(Math.PI * Math.min(1, depth + .06));
        for (let column = 0; column < columns; column += 1) {
          const across = column / (columns - 1);
          const x = across * 2 - 1;
          const wave = Math.sin(x * 4.1 + depth * 5.4 + phase) * .82
            + Math.cos(x * 2.2 - depth * 7.1 - phase * .7) * .42;
          const screenX = width * (.5 + x * .72 * perspective);
          const screenY = height * (.91 - depth * .7) + wave * height * .16 * (.5 + perspective * .56);
          const sideFade = Math.sin(Math.PI * across) ** .42;
          const alpha = Math.max(0, (.12 + perspective * .68) * sideFade * horizonFade);
          const crest = Math.max(0, wave - .34);
          const radius = .55 + perspective * 1.35 + crest * .48;
          context.beginPath();
          context.arc(screenX, screenY, radius, 0, Math.PI * 2);
          context.fillStyle = crest > .16
            ? `rgba(207, 255, 168, ${Math.min(.76, alpha + crest * .16)})`
            : `rgba(118, 185, 0, ${alpha * .72})`;
          context.fill();
        }
      }

      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    let resizeObserver: ResizeObserver | undefined;
    if (window.ResizeObserver) { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); }
    else window.addEventListener("resize", resize, {passive: true});

    let intersectionObserver: IntersectionObserver | undefined;
    if (window.IntersectionObserver) {
      intersectionObserver = new IntersectionObserver(([entry]) => {
        const nextRunning = entry.isIntersecting;
        if (nextRunning === running) return;
        running = nextRunning;
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        if (running) { resize(); animationFrame = window.requestAnimationFrame(draw); }
      });
      intersectionObserver.observe(canvas);
    } else draw(0);

    const onVisibilityChange = () => {
      if (reducedMotion || !running) return;
      window.cancelAnimationFrame(animationFrame);
      if (!document.hidden) animationFrame = window.requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (reducedMotion) { running = true; draw(0); }

    return () => {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className={`point-cloud-wave ${className}`.trim()} aria-hidden="true" />;
}
