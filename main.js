(function () {
  'use strict';

  /* Visitors who ask for less motion lose parallax and tilt.
     Everyone can stop all animation with the Pause motion button. */
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var paused = false;
  try { paused = localStorage.getItem('motion') === 'off'; } catch (e) {}
  var root = document.documentElement;
  root.classList.toggle('still', paused);
  var finePointer = window.matchMedia('(pointer: fine)').matches;

  /* ---------- Rotating portraits with a short cross dissolve ---------- */
  var slides = [
    { src: 'assets/hero-1.webp', caption: 'Research Fellow, AIMS Research and Innovation Centre', alt: 'Jeannette Mukangango in a blue blazer with her arms crossed, smiling.' },
    { src: 'assets/hero-2.webp', caption: 'Speaking at the IKIRERE Physics Camp, 2026', alt: 'Jeannette Mukangango in a floral shirt, speaking into a microphone.' },
    { src: 'assets/hero-3.webp', caption: 'Climate and data researcher', alt: 'Jeannette Mukangango in glasses and a black dress, smiling.' },
    { src: 'assets/cut-4.webp', caption: 'Mathematical scientist', alt: 'Jeannette Mukangango smiling, in an olive jacket.' }
  ];
  var HOLD = 5200;
  var FADE = 900;

  var canvas = document.getElementById('stage-canvas');
  var fallback = document.getElementById('stage-fallback');
  var captionEl = document.getElementById('stage-caption');
  var dotsEl = document.getElementById('stage-dots');
  var current = 0;
  var timer = null;
  var stageVisible = true;

  var dots = slides.map(function (s, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Show photo ' + (i + 1) + ' of ' + slides.length);
    b.setAttribute('aria-current', i === 0 ? 'true' : 'false');
    b.addEventListener('click', function () { goTo(i); });
    dotsEl.appendChild(b);
    return b;
  });

  function setCaption(i) {
    captionEl.classList.add('swap');
    setTimeout(function () {
      captionEl.textContent = slides[i].caption;
      captionEl.classList.remove('swap');
    }, 500);
    dots.forEach(function (d, n) { d.setAttribute('aria-current', n === i ? 'true' : 'false'); });
    canvas.setAttribute('aria-label', slides[i].alt);
    fallback.alt = slides[i].alt;
  }

  var VERT = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  var FRAG = [
    'precision highp float;',
    'varying vec2 v;',
    'uniform sampler2D A;uniform sampler2D B;',
    'uniform float prog;uniform float zA;uniform float zB;',
    'vec2 z(vec2 u,float k){return (u-vec2(.5,.42))/k+vec2(.5,.42);}',
    /* Portrait with a gold and blue rim light */
    'vec4 fig(sampler2D T,vec2 u){',
    '  vec4 c=texture2D(T,u);',
    '  float r=.0065;float l=texture2D(T,u+vec2(-r,0.)).a;float g=texture2D(T,u+vec2(r,0.)).a;',
    '  float t=texture2D(T,u+vec2(0.,r)).a;float b=texture2D(T,u+vec2(0.,-r)).a;',
    '  float avg=(l+g+t+b)*.25;',
    '  float rim=c.a*clamp((1.-avg)*2.,0.,1.);',
    '  float side=clamp((l-g)*.5+.5,0.,1.);',
    '  vec3 tint=mix(vec3(1.,.8,.48),vec3(.5,.74,1.),side);',
    '  c.rgb=c.rgb*.98+tint*rim*.38*c.a;',
    '  return c;',
    '}',
    'void main(){',
    '  vec2 ua=z(v,zA);',
    '  if(prog<=0.){gl_FragColor=fig(A,ua);return;}',
    /* Clean cross dissolve: the new portrait settles in from slightly larger */
    '  vec2 ub=z(v,zB*(1.+(1.-prog)*.035));',
    '  gl_FragColor=mix(fig(A,ua),fig(B,ub),prog);',
    '}'
  ].join('\n');

  var gl = null, prog = null, loc = {}, textures = [], images = [];
  var fromI = 0, toI = 0, startT = 0, transitioning = false, slideStart = 0, prevStart = 0;

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  function initGL() {
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    } catch (e) { gl = null; }
    if (!gl) return false;
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { gl = null; return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return false; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    ['A', 'B', 'prog', 'zA', 'zB'].forEach(function (k) { loc[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1i(loc.A, 0);
    gl.uniform1i(loc.B, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  function makeTexture(img) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return t;
  }

  function sizeCanvas() {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(2, Math.round(r.width * dpr));
    var h = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (gl) gl.viewport(0, 0, w, h);
    }
  }

  /* Slow push-in on each photo */
  function zoomFor(start, now) {
    return 1 + Math.min((now - start) / (HOLD + FADE * 2), 1) * 0.03;
  }

  function ease(x) { return x * x * (3 - 2 * x); }

  function render(now) {
    requestAnimationFrame(render);
    if (!stageVisible || document.hidden) return;
    var p = 0;
    if (transitioning) {
      p = Math.min((now - startT) / FADE, 1);
      if (p >= 1) {
        transitioning = false;
        fromI = toI;
        prevStart = slideStart;
        p = 0;
      }
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[fromI]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[toI]);
    gl.uniform1f(loc.prog, ease(p));
    gl.uniform1f(loc.zA, paused ? 1 : zoomFor(prevStart, now));
    gl.uniform1f(loc.zB, paused ? 1 : zoomFor(slideStart, now));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function goTo(i) {
    if (i === current || (gl && transitioning)) return;
    if (gl && !textures[i]) return;
    current = i;
    setCaption(i);
    if (gl) {
      toI = i;
      startT = performance.now();
      slideStart = startT;
      transitioning = true;
    } else {
      fallback.style.transition = 'opacity .7s';
      fallback.style.opacity = 0;
      setTimeout(function () {
        fallback.src = slides[i].src;
        fallback.style.opacity = 1;
      }, 700);
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(function () {
      if (document.hidden || !stageVisible) { schedule(); return; }
      var next = current;
      for (var n = 1; n <= slides.length; n++) {
        var c = (current + n) % slides.length;
        if (!gl || textures[c]) { next = c; break; }
      }
      if (next !== current) goTo(next); else schedule();
    }, HOLD + (gl ? FADE : 0));
  }

  function startStage() {
    var ok = false;
    try { ok = initGL(); } catch (e) { ok = false; }
    var loaded = 0;
    slides.forEach(function (s, i) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () {
        images[i] = im;
        if (ok) textures[i] = makeTexture(im);
        loaded++;
        if (ok && i === 0) {
          sizeCanvas();
          slideStart = prevStart = performance.now();
          canvas.classList.add('ready');
          fallback.style.visibility = 'hidden';
          requestAnimationFrame(render);
        }
        if (loaded === 1) schedule();
      };
      im.src = s.src;
    });
    if (!ok) canvas.style.display = 'none';
    window.addEventListener('resize', function () { if (gl) sizeCanvas(); });
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { stageVisible = e[0].isIntersecting; }).observe(canvas);
  }
  startStage();

  /* Orbits: a second copy, clipped to the near side, passes in front of the figure */
  var orbits = document.getElementById('orbits');
  var orbitsFront = orbits.cloneNode(true);
  orbitsFront.removeAttribute('id');
  orbitsFront.classList.add('front');
  var NS = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(NS, 'defs');
  var cp = document.createElementNS(NS, 'clipPath');
  cp.setAttribute('id', 'near-side');
  var rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', -700);
  rect.setAttribute('y', 0);
  rect.setAttribute('width', 1400);
  rect.setAttribute('height', 500);
  cp.appendChild(rect);
  defs.appendChild(cp);
  orbitsFront.insertBefore(defs, orbitsFront.firstChild);
  [].slice.call(orbitsFront.querySelectorAll('.orbit')).forEach(function (g) { g.setAttribute('clip-path', 'url(#near-side)'); });
  document.getElementById('scene').appendChild(orbitsFront);
  if (paused) { orbits.pauseAnimations(); orbitsFront.pauseAnimations(); }

  /* Slight depth when the pointer moves */
  if (finePointer && !calm) {
    window.addEventListener('pointermove', function (e) {
      if (paused) return;
      var x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5;
      canvas.style.transform = 'translate3d(' + (x * -12).toFixed(1) + 'px,' + (y * -8).toFixed(1) + 'px,0)';
      orbits.style.transform = orbitsFront.style.transform = 'translate3d(' + (x * 16).toFixed(1) + 'px,' + (y * 10).toFixed(1) + 'px,0)';
    }, { passive: true });
  }

  /* ---------- Wind field: particles drifting along a moving flow ---------- */
  var wind = document.getElementById('wind');
  if (wind.getContext) {
    var ctx = wind.getContext('2d');
    var W = 0, H = 0, parts = [], mouse = { x: -9999, y: -9999 };
    var last = 0, step = window.innerWidth < 760 ? 33 : 16;

    var spawn = function (p) {
      p.x = Math.random() * W;
      p.y = Math.random() * H;
      p.life = 60 + Math.random() * 160;
      p.c = Math.random() < 0.72 ? 0 : 1;
      return p;
    };

    var resize = function () {
      W = wind.width = window.innerWidth;
      H = wind.height = window.innerHeight;
      var target = Math.round(Math.min(900, (W * H) / 1700));
      parts = [];
      for (var i = 0; i < target; i++) parts.push(spawn({}));
    };

    var flow = function (x, y, t) {
      return Math.sin(x * 0.0017 + t * 0.09) * 1.25 +
             Math.cos(y * 0.0023 - t * 0.07) * 1.35 +
             Math.sin((x + y) * 0.0012 + t * 0.05) * 0.95;
    };

    var tick = function (now) {
      requestAnimationFrame(tick);
      if (paused || document.hidden || now - last < step) return;
      last = now;
      var t = now / 1000;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.075)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.25;
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? 'rgba(236,200,132,0.46)' : 'rgba(159,208,255,0.38)';
        ctx.beginPath();
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          if (p.c !== pass) continue;
          var a = flow(p.x, p.y, t);
          var vx = Math.cos(a) * 1.5 + 0.55;
          var vy = Math.sin(a) * 1.5;
          var dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < 22000) {
            var f = (1 - d2 / 22000) * 3.2;
            vx += (-dy / 148) * f;
            vy += (dx / 148) * f;
          }
          ctx.moveTo(p.x, p.y);
          p.x += vx;
          p.y += vy;
          ctx.lineTo(p.x, p.y);
          p.life--;
          if (p.life < 0 || p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5) spawn(p);
        }
        ctx.stroke();
      }
    };

    resize();
    window.addEventListener('resize', resize);
    if (finePointer) {
      window.addEventListener('pointermove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    }
    requestAnimationFrame(tick);
  }

  /* ---------- Scroll effects ---------- */
  var header = document.querySelector('.site-header');
  var bar = document.querySelector('.progress span');
  var timeline = document.getElementById('timeline');
  var layers = [].slice.call(document.querySelectorAll('[data-parallax]'));
  var ticking = false;

  function onScroll() {
    ticking = false;
    var y = window.scrollY, vh = window.innerHeight;
    var max = document.documentElement.scrollHeight - vh;
    bar.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
    header.classList.toggle('solid', y > 40);
    wind.style.opacity = y > vh * 0.7 ? 0.75 : 1;
    var r = timeline.getBoundingClientRect();
    var done = (vh * 0.62 - r.top) / r.height;
    timeline.style.setProperty('--tl', Math.max(0, Math.min(1, done)).toFixed(3));
    if (!calm && !paused) {
      layers.forEach(function (el) {
        var b = el.parentNode.getBoundingClientRect();
        if (b.bottom < -100 || b.top > vh + 100) return;
        var c = (b.top + b.height / 2 - vh / 2) * parseFloat(el.dataset.parallax);
        el.style.transform = 'translate3d(0,' + (-c).toFixed(1) + 'px,0)';
      });
    }
  }
  function requestScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }
  window.addEventListener('scroll', requestScroll, { passive: true });
  window.addEventListener('resize', requestScroll);
  onScroll();

  /* Reveal on entering the viewport */
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !paused) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
        if (e.target.classList.contains('tilt')) {
          setTimeout(function () { e.target.classList.add('settled'); }, 1300);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* Highlight the current section in the menu */
  var links = [].slice.call(document.querySelectorAll('.site-header nav a'));
  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (l) {
      var s = document.querySelector(l.getAttribute('href'));
      if (s) spy.observe(s);
    });
  }

  /* Pause and play button */
  var toggle = document.getElementById('motion-toggle');
  function showToggle() {
    toggle.textContent = paused ? 'Play motion' : 'Pause motion';
    toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }
  toggle.addEventListener('click', function () {
    paused = !paused;
    root.classList.toggle('still', paused);
    [orbits, orbitsFront].forEach(function (o) { if (paused) o.pauseAnimations(); else o.unpauseAnimations(); });
    try { localStorage.setItem('motion', paused ? 'off' : 'on'); } catch (e) {}
    reveals.forEach(function (el) { el.classList.add('in'); });
    showToggle();
    schedule();
  });
  showToggle();

  /* Card tilt and glow following the pointer */
  if (finePointer && !calm) {
    [].slice.call(document.querySelectorAll('.tilt')).forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        var x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        el.style.setProperty('--ry', ((x - 0.5) * 5).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }
})();
