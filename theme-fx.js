// NovaPlus Theme FX — ambient particle overlay engine
// Presets: 'none', 'winter', 'spring', 'summer', 'autumn'
// Renders on a single full-window canvas, non-interactive (pointer-events: none).
// Usage:
//   NovaFX.mount(document.getElementById('fx-canvas'));
//   NovaFX.setEffect('winter', { intensity: 'medium' }); // 'low' | 'medium' | 'high'
//   NovaFX.setEffect('none'); // stops and clears

(function (global) {
    const INTENSITY_COUNTS = {
        winter:  { low: 40,  medium: 80,  high: 140 },
        spring:  { low: 30,  medium: 60,  high: 100 },
        summer:  { low: 20,  medium: 40,  high: 70  },
        autumn:  { low: 25,  medium: 50,  high: 90  }
    };

    let canvas = null;
    let ctx = null;
    let rafId = null;
    let particles = [];
    let currentEffect = 'none';
    let currentIntensity = 'medium';
    let W = 0, H = 0;
    let resizeObserver = null;

    function rand(a, b) { return a + Math.random() * (b - a); }

    function resize() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        W = canvas.clientWidth;
        H = canvas.clientHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeParticles(kind, count) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            if (kind === 'winter') {
                arr.push({
                    x: rand(0, W), y: rand(0, H),
                    r: rand(1.5, 4), vy: rand(0.3, 1.1), drift: rand(0, Math.PI * 2)
                });
            } else if (kind === 'spring') {
                arr.push({
                    x: rand(0, W), y: rand(-H, 0),
                    size: rand(5, 10), vy: rand(0.3, 0.9),
                    rot: rand(0, Math.PI * 2), vr: rand(-0.015, 0.015),
                    hue: Math.random() > 0.5 ? '#F4C0D1' : '#FBEAF0',
                    sway: rand(0, Math.PI * 2)
                });
            } else if (kind === 'summer') {
                arr.push({
                    x: rand(0, W), y: rand(0, H),
                    size: rand(1.5, 3), vy: rand(-0.4, -0.1),
                    drift: rand(0, Math.PI * 2), blink: rand(0, Math.PI * 2),
                    blinkSpeed: rand(0.03, 0.07)
                });
            } else if (kind === 'autumn') {
                arr.push({
                    x: rand(0, W), y: rand(-H, 0),
                    size: rand(6, 13), vy: rand(0.4, 1.2),
                    rot: rand(0, Math.PI * 2), vr: rand(-0.02, 0.02),
                    hue: Math.random() > 0.5 ? '#EF9F27' : '#D85A30',
                    sway: rand(0, Math.PI * 2)
                });
            }
        }
        return arr;
    }

    function stepWinter() {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const p of particles) {
            p.y += p.vy;
            p.drift += 0.02;
            p.x += Math.sin(p.drift) * 0.3;
            if (p.y > H) { p.y = -5; p.x = rand(0, W); }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function stepSpring() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.y += p.vy;
            p.sway += 0.025;
            p.x += Math.sin(p.sway) * 0.7;
            p.rot += p.vr;
            if (p.y > H + 20) { p.y = -20; p.x = rand(0, W); }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.hue;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 0.55, p.size, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function stepSummer() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.y += p.vy;
            p.drift += 0.015;
            p.x += Math.sin(p.drift) * 0.4;
            p.blink += p.blinkSpeed;
            if (p.y < -5) { p.y = H + 5; p.x = rand(0, W); }
            const glow = (Math.sin(p.blink) + 1) / 2;
            ctx.fillStyle = `rgba(250, 199, 117, ${0.2 + glow * 0.7})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size + glow * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function stepAutumn() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.y += p.vy;
            p.sway += 0.03;
            p.x += Math.sin(p.sway) * 0.6;
            p.rot += p.vr;
            if (p.y > H + 20) { p.y = -20; p.x = rand(0, W); }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.hue;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function loop() {
        if (currentEffect === 'winter') stepWinter();
        else if (currentEffect === 'spring') stepSpring();
        else if (currentEffect === 'summer') stepSummer();
        else if (currentEffect === 'autumn') stepAutumn();
        rafId = requestAnimationFrame(loop);
    }

    function stop() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (ctx) ctx.clearRect(0, 0, W, H);
        particles = [];
    }

    const NovaFX = {
        // Attach the engine to a canvas element. Call once at startup.
        mount(canvasEl) {
            canvas = canvasEl;
            ctx = canvas.getContext('2d');
            resize();
            window.addEventListener('resize', resize);
            if (window.ResizeObserver) {
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(canvas);
            }
        },

        // effect: 'none' | 'winter' | 'spring' | 'summer' | 'autumn'
        // opts.intensity: 'low' | 'medium' | 'high' (default 'medium')
        setEffect(effect, opts) {
            opts = opts || {};
            currentIntensity = opts.intensity || currentIntensity || 'medium';
            stop();
            currentEffect = effect;
            if (effect === 'none' || !canvas) return;
            resize();
            const count = (INTENSITY_COUNTS[effect] && INTENSITY_COUNTS[effect][currentIntensity]) || 60;
            particles = makeParticles(effect, count);
            loop();
        },

        setIntensity(intensity) {
            currentIntensity = intensity;
            if (currentEffect !== 'none') this.setEffect(currentEffect, { intensity });
        },

        getEffect() { return currentEffect; },
        getIntensity() { return currentIntensity; },

        destroy() {
            stop();
            window.removeEventListener('resize', resize);
            if (resizeObserver) resizeObserver.disconnect();
        }
    };

    global.NovaFX = NovaFX;
})(window);