// NovaPlus Theme FX — ambient particle overlay engine
// Presets: 'none', 'winter', 'spring', 'summer', 'autumn' (Four Seasons Pack)
//          'aura', 'speedlines', 'sakuragale', 'chispark' (Anime Effects Pack)
// Renders on a single full-window canvas, non-interactive (pointer-events: none).
// Usage:
//   NovaFX.mount(document.getElementById('fx-canvas'));
//   NovaFX.setEffect('winter', { intensity: 'medium' }); // 'low' | 'medium' | 'high'
//   NovaFX.setEffect('none'); // stops and clears

(function (global) {
    const INTENSITY_COUNTS = {
        winter:      { low: 40,  medium: 80,  high: 140 },
        spring:      { low: 30,  medium: 60,  high: 100 },
        summer:      { low: 20,  medium: 40,  high: 70  },
        autumn:      { low: 25,  medium: 50,  high: 90  },
        aura:        { low: 18,  medium: 32,  high: 52  },
        speedlines:  { low: 14,  medium: 24,  high: 40  },
        sakuragale:  { low: 40,  medium: 75,  high: 120 },
        chispark:    { low: 30,  medium: 55,  high: 85  }
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
            } else if (kind === 'aura') {
                arr.push({
                    // large soft glow blobs pulsing near the frame edges
                    edge: i % 4, // 0=top,1=right,2=bottom,3=left
                    t: rand(0.1, 0.9),
                    size: rand(90, 160),
                    phase: rand(0, Math.PI * 2),
                    speed: rand(0.015, 0.03),
                    hue: Math.random() > 0.5 ? [130, 90, 255] : [90, 180, 255]
                });
            } else if (kind === 'speedlines') {
                arr.push({
                    angle: rand(0, Math.PI * 2),
                    len: rand(120, 260),
                    dist: rand(0, 1), // 0 = at center, 1 = fully out
                    speed: rand(0.012, 0.026),
                    thickness: rand(1.5, 3)
                });
            } else if (kind === 'sakuragale') {
                arr.push({
                    x: rand(-40, W), y: rand(-H, H),
                    size: rand(5, 11), vy: rand(1.4, 2.6), vx: rand(1.6, 2.8),
                    rot: rand(0, Math.PI * 2), vr: rand(-0.06, 0.06),
                    hue: Math.random() > 0.5 ? '#F4C0D1' : '#FBEAF0'
                });
            } else if (kind === 'chispark') {
                arr.push({
                    x: rand(0, W), y: rand(0, H),
                    size: rand(1.5, 3.2), vy: rand(-1.1, -0.4),
                    drift: rand(0, Math.PI * 2), blink: rand(0, Math.PI * 2),
                    blinkSpeed: rand(0.06, 0.12),
                    hue: Math.random() > 0.5 ? [150, 120, 255] : [110, 200, 255]
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

    function stepAura() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.phase += p.speed;
            const pulse = (Math.sin(p.phase) + 1) / 2; // 0..1
            let x, y;
            if (p.edge === 0) { x = W * p.t; y = 0; }
            else if (p.edge === 1) { x = W; y = H * p.t; }
            else if (p.edge === 2) { x = W * p.t; y = H; }
            else { x = 0; y = H * p.t; }
            const r = p.size * (0.7 + pulse * 0.5);
            const [hr, hg, hb] = p.hue;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(${hr},${hg},${hb},${0.16 + pulse * 0.14})`);
            grad.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function stepSpeedlines() {
        ctx.clearRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2;
        const maxR = Math.hypot(W, H) / 2;
        for (const p of particles) {
            p.dist += p.speed;
            if (p.dist > 1) { p.dist = 0; p.angle = rand(0, Math.PI * 2); }
            const startR = p.dist * maxR;
            const endR = startR + p.len;
            const alpha = 0.5 * (1 - p.dist);
            const x0 = cx + Math.cos(p.angle) * startR;
            const y0 = cy + Math.sin(p.angle) * startR;
            const x1 = cx + Math.cos(p.angle) * endR;
            const y1 = cy + Math.sin(p.angle) * endR;
            ctx.strokeStyle = `rgba(200,220,255,${Math.max(0, alpha)})`;
            ctx.lineWidth = p.thickness;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }
    }

    function stepSakuragale() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.y += p.vy;
            p.x += p.vx;
            p.rot += p.vr;
            if (p.y > H + 20 || p.x > W + 20) {
                p.y = rand(-H, -10);
                p.x = rand(-40, W * 0.3);
            }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.hue;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 0.5, p.size, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function stepChispark() {
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
            p.y += p.vy;
            p.drift += 0.02;
            p.x += Math.sin(p.drift) * 0.5;
            p.blink += p.blinkSpeed;
            if (p.y < -5) { p.y = H + 5; p.x = rand(0, W); }
            const glow = (Math.sin(p.blink) + 1) / 2;
            const [hr, hg, hb] = p.hue;
            ctx.fillStyle = `rgba(${hr},${hg},${hb},${0.25 + glow * 0.65})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size + glow * 1.8, 0, Math.PI * 2);
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
        else if (currentEffect === 'aura') stepAura();
        else if (currentEffect === 'speedlines') stepSpeedlines();
        else if (currentEffect === 'sakuragale') stepSakuragale();
        else if (currentEffect === 'chispark') stepChispark();
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