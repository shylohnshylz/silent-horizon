/* ==========================================================================
   SILENT HORIZON INFO TECH — script.js
   --------------------------------------------------------------------------
   1. CONFIG            — paste your Google Apps Script Web App URL here
   2. Boot sequence
   3. Universe          — hand-written WebGL: galaxy, starfield, black hole
   4. Interface         — nav, reveals, tilt, cursor glow, scroll progress
   5. Lead capture      — validation + fetch() to Google Sheets
   ========================================================================== */

(() => {
  'use strict';

  /* =======================================================================
     1. CONFIG
     ======================================================================= */

  const CONFIG = {
    /* ─────────────────────────────────────────────────────────────────────
       ⚠️  PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL BETWEEN THE QUOTES
       It looks like:
       https://script.google.com/macros/s/AKfycb....................../exec

       Full walkthrough in README.md → Part 3, Step 1.
       ───────────────────────────────────────────────────────────────────── */
    WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbxBPBp9t38Izca-_ZsgktEfZi2Mf1sCIIcvMy1q48YKpy_eiIuXnEnnhupnT9UZ3mny/exec',

    /* Milliseconds to wait before we stop waiting on Google and reassure the
       visitor anyway. Apps Script can take a few seconds on a cold start. */
    SUBMIT_TIMEOUT: 12000,

    /* Where the "email us instead" fallback points if the network fails. */
    FALLBACK_EMAIL: 'hello@silenthorizon.in'
  };

  const PLACEHOLDER = /PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE/;
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HAS_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* =======================================================================
     2. BOOT SEQUENCE
     ======================================================================= */

  function boot() {
    const lid = $('#boot');
    const reveal = () => {
      document.body.classList.add('is-ready');
      if (lid) lid.classList.add('is-done');
    };

    // Hero headline stagger (each line rises a beat after the last).
    $$('.hero__line').forEach((line, i) => line.style.setProperty('--d', `${60 + i * 110}ms`));

    if (REDUCED_MOTION) { reveal(); return; }

    // Hold the lid just long enough to feel deliberate, never longer.
    const started = performance.now();
    const finish = () => {
      const wait = Math.max(0, 620 - (performance.now() - started));
      window.setTimeout(reveal, wait);
    };
    if (document.readyState === 'complete') finish();
    else window.addEventListener('load', finish, { once: true });
    // Safety net: never leave the overlay up if a font or asset stalls.
    window.setTimeout(reveal, 3500);
  }

  /* =======================================================================
     3. THE UNIVERSE  (WebGL — no libraries, ~12 KB of maths)

     The scene is three passes drawn into one full-screen canvas:

       PASS 1  galaxy arms   ~5,000 soft points on a spiral disc
       PASS 2  starfield     ~1,600 distant stars that twinkle
       PASS 3  black hole    one full-screen quad, entirely procedural
                             (event horizon, photon ring, accretion disc)

     Everything is generated once on the CPU; per-frame work is a handful of
     uniforms plus three draw calls, which is why it stays smooth on phones.
     ======================================================================= */

  function createUniverse(canvas) {
    /* ---------------------------------------------------------- context */
    const attrs = {
      alpha: true, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, powerPreference: 'high-performance'
    };
    const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) return null;

    const isSmall = window.matchMedia('(max-width: 720px)').matches;
    const COUNTS = {
      stars: isSmall ? 800 : 1700,
      galaxy: isSmall ? 2400 : 5400
    };

    /* ------------------------------------------------------ tiny mat4 lib */
    // Column-major 4×4 matrices, exactly how WebGL wants them.
    const M4 = {
      perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
        return new Float32Array([
          f / aspect, 0, 0, 0,
          0, f, 0, 0,
          0, 0, (far + near) * nf, -1,
          0, 0, 2 * far * near * nf, 0
        ]);
      },
      rotX(a) {
        const c = Math.cos(a), s = Math.sin(a);
        return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
      },
      rotY(a) {
        const c = Math.cos(a), s = Math.sin(a);
        return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
      },
      translate(x, y, z) {
        return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
      },
      multiply(a, b) { // a * b
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
          for (let r = 0; r < 4; r++) {
            o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                           a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
          }
        }
        return o;
      }
    };

    /* --------------------------------------------------------- gl helpers */
    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(sh), src);
        return null;
      }
      return sh;
    }

    function program(vsSrc, fsSrc) {
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Link error:', gl.getProgramInfoLog(p));
        return null;
      }
      // Cache every uniform/attribute location up front.
      const wrap = { id: p, u: {}, a: {} };
      const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < nu; i++) {
        const info = gl.getActiveUniform(p, i);
        wrap.u[info.name] = gl.getUniformLocation(p, info.name);
      }
      const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < na; i++) {
        const info = gl.getActiveAttrib(p, i);
        wrap.a[info.name] = gl.getAttribLocation(p, info.name);
      }
      return wrap;
    }

    function buffer(data) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    }

    function attrib(prog, name, buf, size) {
      const loc = prog.a[name];
      if (loc === undefined || loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }

    /* ---------------------------------------------------------- shaders */

    // Shared by both point clouds: project, lens, size, fade.
    const POINT_LIB = `
      uniform mat4 u_mvp;
      uniform mat4 u_view;
      uniform float u_time;
      uniform float u_dpr;
      uniform vec2 u_hole;     // black hole centre, in normalised device coords
      uniform float u_lens;    // lensing strength
      varying vec3 v_color;
      varying float v_alpha;

      // Gravity bends light: points near the singularity are pushed outward,
      // which smears them into a bright halo around the event horizon.
      vec4 project(vec3 pos, vec2 misc, vec3 color) {
        vec4 viewPos = u_view * vec4(pos, 1.0);
        vec4 clip = u_mvp * vec4(pos, 1.0);

        if (clip.w < 0.18) {           // behind the camera → cull
          v_alpha = 0.0; v_color = vec3(0.0);
          gl_PointSize = 0.0;
          return vec4(2.0, 2.0, 2.0, 1.0);
        }

        vec2 ndc = clip.xy / clip.w;
        vec2 d = ndc - u_hole;
        float dist2 = dot(d, d) + 0.0018;
        float pull = min(u_lens / dist2, 0.17);
        ndc += normalize(d + vec2(0.00001)) * pull;
        clip.xy = ndc * clip.w;

        float twinkle = 0.62 + 0.38 * sin(u_time * 1.6 + misc.y * 61.0);
        // Perspective size falloff, clamped so nothing ever becomes a blob
        float size = misc.x * u_dpr * (26.0 / max(1.0, -viewPos.z)) * (0.82 + 0.34 * twinkle);
        gl_PointSize = clamp(size, 1.0, 7.0 * u_dpr);

        v_color = color;
        v_alpha = (0.34 + 0.66 * twinkle) * smoothstep(0.18, 0.75, clip.w);
        return clip;
      }
    `;

    const POINT_FS = `
      precision mediump float;
      varying vec3 v_color;
      varying float v_alpha;
      void main() {
        // Round, soft-edged sprite (GL points are squares; this kills the corners)
        float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float a = smoothstep(1.0, 0.12, r);
        a *= a;
        float i = a * v_alpha;
        gl_FragColor = vec4(v_color * i, i);
      }
    `;

    const STAR_VS = `
      attribute vec3 a_pos;
      attribute vec2 a_misc;   // x = size, y = seed
      attribute vec3 a_color;
      ${POINT_LIB}
      void main() { gl_Position = project(a_pos, a_misc, a_color); }
    `;

    // Galaxy points live in polar form so the shader can spin them for free.
    const GALAXY_VS = `
      attribute vec3 a_polar;  // x = radius, y = angle, z = height
      attribute vec2 a_misc;   // x = size,  y = seed
      attribute vec3 a_color;
      ${POINT_LIB}
      void main() {
        float r = a_polar.x;
        // Differential rotation: inner orbits are faster, so the arms shear
        // very slowly — alive, but never losing their spiral.
        float omega = 0.075 * (1.0 + 0.65 / (r * r));
        float ang = a_polar.y + u_time * omega;
        float breathe = 1.0 + 0.014 * sin(u_time * 0.55 + a_misc.y * 33.0);
        vec3 pos = vec3(
          cos(ang) * r * breathe,
          a_polar.z * (1.0 + 0.05 * sin(u_time * 0.4 + a_misc.y * 21.0)),
          sin(ang) * r * breathe
        );
        gl_Position = project(pos, a_misc, a_color);
      }
    `;

    /* The black hole. One quad, all fragment shader:
         · event horizon  — an opaque black disc that occludes the galaxy
         · photon ring    — a razor-thin, blown-out ring of light at 1.16 r
         · accretion disc — squashed ring of swirling noise, cyan→violet→magenta
         · lensed arc     — the far side of the disc bent up over the top */
    const HOLE_VS = `
      attribute vec2 a_quad;
      void main() { gl_Position = vec4(a_quad, 0.0, 1.0); }
    `;

    const HOLE_FS = `
      precision highp float;
      uniform vec2  u_res;
      uniform vec2  u_center;
      uniform float u_radius;
      uniform float u_time;
      uniform float u_fade;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.04; a *= 0.5; }
        return v;
      }

      void main() {
        // Work in units of the event-horizon radius: 1.0 == the horizon.
        vec2 p = (gl_FragCoord.xy - u_center) / u_radius;
        float pl = length(p);
        if (pl > 7.0) discard;

        // ---- accretion disc ------------------------------------------------
        // Squash on Y so the disc reads as a flat plane seen at a low angle
        // (0.26 ≈ sin of a 15° camera elevation — set in the camera block).
        vec2 q = vec2(p.x, p.y / 0.26);
        float rr = length(q);

        vec3 col = vec3(0.0);
        float alpha = 0.0;

        if (rr < 5.2 && rr > 0.9) {
          // Twist the sampling coordinates by an amount that depends on radius:
          // that is what makes the disc appear to swirl rather than translate.
          float twist = 1.9 / pow(rr + 0.35, 1.15) + u_time * 0.32;
          float ct = cos(twist), st = sin(twist);
          vec2 rq = vec2(ct * q.x - st * q.y, st * q.x + ct * q.y);

          float n = fbm(rq * 2.25 + vec2(u_time * 0.05, 0.0));
          // A ring, not a fog bank: hard-ish inner lip at the ISCO radius,
          // long tail outward, and noise raised to a power to keep filaments.
          float band = smoothstep(1.04, 1.30, rr) * (1.0 - smoothstep(2.2, 3.7, rr));
          float dens = band * (0.10 + 1.25 * pow(n, 1.5));

          // Colour ramp: white-hot inner edge → violet → magenta rim
          float t = clamp((rr - 1.02) / 3.6, 0.0, 1.0);
          vec3 cIn  = vec3(0.52, 0.94, 1.00);   // cyan-white inner lip
          vec3 cMid = vec3(0.60, 0.48, 1.00);   // deep violet midsection
          vec3 cOut = vec3(1.00, 0.28, 0.78);   // magenta outer tail
          vec3 diskCol = mix(cIn, cMid, smoothstep(0.0, 0.42, t));
          diskCol = mix(diskCol, cOut, smoothstep(0.42, 1.0, t));

          col += diskCol * dens;
          alpha = max(alpha, dens);
        }

        // ---- lensed arc (far side of the disc, bent over the top) ----------
        if (pl < 3.0 && p.y > -0.1) {
          float arcBand = smoothstep(1.06, 1.30, pl) * (1.0 - smoothstep(1.55, 2.35, pl));
          arcBand *= smoothstep(-0.05, 0.5, p.y);
          float arcN = fbm(vec2(p.x * 2.4, p.y * 5.0 - u_time * 0.25));
          float arc = arcBand * (0.05 + 0.70 * pow(arcN, 1.5));
          col += vec3(0.72, 0.80, 1.00) * arc;
          alpha = max(alpha, arc);
        }

        // ---- photon ring: light orbiting the horizon -----------------------
        float ring = exp(-pow((pl - 1.14) / 0.048, 2.0)) * 1.15;
        float bloom = exp(-pow((pl - 1.04) / 0.42, 2.0)) * 0.16;
        col += vec3(0.80, 0.97, 1.00) * (ring + bloom);
        alpha = max(alpha, min(ring * 0.9 + bloom, 1.0));

        // ---- event horizon: pure black, fully opaque -----------------------
        float holeMask = 1.0 - smoothstep(0.94, 1.03, pl);
        col = mix(col, vec3(0.0), holeMask);
        alpha = mix(alpha, 1.0, holeMask);

        // Fade out before the quad edge so there is never a visible seam.
        float edge = 1.0 - smoothstep(3.4, 5.6, pl);
        col *= edge;
        alpha *= edge;

        if (alpha < 0.004) discard;

        // Premultiplied output: adds light where there is glow, and wipes the
        // background to black inside the horizon.
        gl_FragColor = vec4(col * alpha * u_fade, alpha);
      }
    `;

    /* ------------------------------------------------------ build assets */
    const progGalaxy = program(GALAXY_VS, POINT_FS);
    const progStar = program(STAR_VS, POINT_FS);
    const progHole = program(HOLE_VS, HOLE_FS);
    if (!progGalaxy || !progStar || !progHole) return null;

    const rand = (a, b) => a + Math.random() * (b - a);
    const gauss = () => {
      // Box–Muller — clustered values make natural-looking arms and dust.
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const mix3 = (a, b, t) => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];

    /* ---- galaxy: three logarithmic arms + a loose halo of dust ---------- */
    (function buildGalaxy() {
      const n = COUNTS.galaxy;
      const polar = new Float32Array(n * 3);
      const misc = new Float32Array(n * 2);
      const color = new Float32Array(n * 3);
      const C_INNER = [0.72, 0.98, 1.0];    // cyan-white core
      const C_MID = [0.58, 0.55, 1.0];      // violet
      const C_OUTER = [1.0, 0.36, 0.82];    // magenta rim
      const ARMS = 3;

      for (let i = 0; i < n; i++) {
        // sqrt-ish distribution → dense core, sparse edges
        const radius = 0.95 + Math.pow(Math.random(), 0.62) * 7.4;
        const arm = i % ARMS;
        // Spiral: angle grows with radius (logarithmic-ish) + scatter
        const angle = arm * (Math.PI * 2 / ARMS) +
                      radius * 0.62 +
                      gauss() * (0.10 + 0.22 * (radius / 8));
        // Thin disc that thickens slightly outward
        const height = gauss() * (0.035 + 0.075 * radius / 8);

        polar[i * 3] = radius;
        polar[i * 3 + 1] = angle;
        polar[i * 3 + 2] = height;

        const t = Math.min(1, (radius - 0.95) / 7.4);
        const c = t < 0.45
          ? mix3(C_INNER, C_MID, t / 0.45)
          : mix3(C_MID, C_OUTER, (t - 0.45) / 0.55);

        // A few bright "stars" among the dust
        const spark = Math.random() > 0.965 ? 1.9 : 1.0;
        color[i * 3] = c[0] * spark;
        color[i * 3 + 1] = c[1] * spark;
        color[i * 3 + 2] = c[2] * spark;

        misc[i * 2] = rand(0.9, 2.5) * (spark > 1 ? 1.25 : 1);
        misc[i * 2 + 1] = Math.random();
      }

      const bPolar = buffer(polar), bMisc = buffer(misc), bColor = buffer(color);
      progGalaxy.build = () => {
        attrib(progGalaxy, 'a_polar', bPolar, 3);
        attrib(progGalaxy, 'a_misc', bMisc, 2);
        attrib(progGalaxy, 'a_color', bColor, 3);
      };
      progGalaxy.count = n;
    })();

    /* ---- starfield: a shell of distant suns ----------------------------- */
    (function buildStars() {
      const n = COUNTS.stars;
      const pos = new Float32Array(n * 3);
      const misc = new Float32Array(n * 2);
      const color = new Float32Array(n * 3);
      const TINTS = [
        [0.92, 0.97, 1.00], // starlight white
        [0.66, 0.90, 1.00], // cyan
        [0.74, 0.70, 1.00], // violet
        [1.00, 0.76, 0.94]  // magenta
      ];

      for (let i = 0; i < n; i++) {
        // Random point on a sphere, radius 14–42 (far outside the galaxy)
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const r = 14 + Math.pow(Math.random(), 0.7) * 28;

        pos[i * 3] = Math.cos(theta) * s * r;
        pos[i * 3 + 1] = u * r * 0.75;
        pos[i * 3 + 2] = Math.sin(theta) * s * r;

        misc[i * 2] = rand(0.7, 2.2);
        misc[i * 2 + 1] = Math.random();

        const tint = TINTS[Math.floor(Math.random() * TINTS.length)];
        const lum = rand(0.45, 1.0);
        color[i * 3] = tint[0] * lum;
        color[i * 3 + 1] = tint[1] * lum;
        color[i * 3 + 2] = tint[2] * lum;
      }

      const bPos = buffer(pos), bMisc = buffer(misc), bColor = buffer(color);
      progStar.build = () => {
        attrib(progStar, 'a_pos', bPos, 3);
        attrib(progStar, 'a_misc', bMisc, 2);
        attrib(progStar, 'a_color', bColor, 3);
      };
      progStar.count = n;
    })();

    // The full-screen quad for the black hole
    const quadBuf = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));

    /* --------------------------------------------------------- rendering */
    let width = 0, height = 0, dprScale = 1;
    const MAX_DPR = isSmall ? 1.6 : 2;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * dprScale;
      width = Math.round(w * dpr);
      height = Math.round(h * dpr);
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    resize();

    // Camera state, smoothed toward the pointer
    const cam = {
      yaw: 0, pitch: 0,
      targetYaw: 0, targetPitch: 0,
      dist: isSmall ? 12.5 : 9.4,
      elev: 1.9
    };
    let scrollY = 0;

    function onPointer(e) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      cam.targetYaw = nx * 0.16;
      cam.targetPitch = ny * 0.10;
    }
    if (HAS_HOVER && !REDUCED_MOTION) {
      window.addEventListener('pointermove', onPointer, { passive: true });
    }
    window.addEventListener('scroll', () => { scrollY = window.scrollY || 0; }, { passive: true });

    let raf = 0, t0 = 0, last = 0;
    let frames = 0, acc = 0, tuned = false;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;

      if (!t0) t0 = now;
      const t = (now - t0) / 1000;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;

      // Adaptive quality: if we can't hold ~45fps, quietly drop resolution.
      if (!tuned && !REDUCED_MOTION) {
        acc += dt; frames++;
        if (frames >= 90) {
          const avg = acc / frames;
          if (avg > 0.024 && window.devicePixelRatio > 1) {
            dprScale = 0.75;
            resize();
          }
          tuned = true;
        }
      }

      const ease = 1 - Math.pow(0.0015, dt); // frame-rate independent lerp
      cam.yaw += (cam.targetYaw - cam.yaw) * ease;
      cam.pitch += (cam.targetPitch - cam.pitch) * ease;

      const scrollRatio = Math.min(1, scrollY / Math.max(1, window.innerHeight));
      const drift = t * 0.012;                       // slow cosmic drift
      const dist = cam.dist + scrollRatio * 3.4;     // dolly out as you descend

      const proj = M4.perspective(58 * Math.PI / 180, width / height, 0.1, 120);

      // Lens shift: frame the singularity right-of-centre on desktop and
      // high up on phones, so the headline always has clean space.
      // (Proj[8]/[9] are added to clip.xy *before* the perspective divide, and
      //  clip.w is positive, so a NEGATIVE value pushes the scene right / up.)
      // Portrait screens get a different composition: the singularity is
      // pushed into the top-right corner (partly off-screen) so the hero copy
      // owns the lower-left and never fights a bright ring for contrast.
      const wide = width / height > 1.25;
      proj[8] = wide ? -0.30 : -1.05;
      proj[9] = wide ? -0.10 : -0.95;

      const view = M4.multiply(
        M4.multiply(M4.rotX(cam.pitch), M4.rotY(cam.yaw + drift * 0.35)),
        M4.translate(0, -cam.elev, -dist)
      );
      const mvp = M4.multiply(proj, view);

      // Where does the singularity (world origin) land on screen?
      const cw = mvp[15];
      const ndcX = mvp[12] / cw, ndcY = mvp[13] / cw;
      const hole = [ndcX, ndcY];

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      /* ---- pass 1 + 2: point clouds, additive -------------------------- */
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // additive: light adds to light

      const drawPoints = (prog) => {
        gl.useProgram(prog.id);
        prog.build();
        gl.uniformMatrix4fv(prog.u.u_mvp, false, mvp);
        gl.uniformMatrix4fv(prog.u.u_view, false, view);
        gl.uniform1f(prog.u.u_time, t);
        gl.uniform1f(prog.u.u_dpr, Math.min(window.devicePixelRatio || 1, MAX_DPR) * dprScale);
        gl.uniform2f(prog.u.u_hole, hole[0], hole[1]);
        gl.uniform1f(prog.u.u_lens, 0.0009);
        gl.drawArrays(gl.POINTS, 0, prog.count);
      };
      drawPoints(progGalaxy);
      drawPoints(progStar);

      /* ---- pass 3: the black hole, premultiplied over everything ------- */
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(progHole.id);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(progHole.a.a_quad);
      gl.vertexAttribPointer(progHole.a.a_quad, 2, gl.FLOAT, false, 0, 0);

      const px = [ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5];
      const radiusPx = Math.min(width, height) * (wide ? 0.118 : 0.31);

      gl.uniform2f(progHole.u.u_res, width, height);
      gl.uniform2f(progHole.u.u_center, px[0] * width, px[1] * height);
      gl.uniform1f(progHole.u.u_radius, radiusPx);
      gl.uniform1f(progHole.u.u_time, t);
      gl.uniform1f(progHole.u.u_fade, 1.0 - scrollRatio * 0.55);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.disable(gl.BLEND);
    }

    // Static single frame for reduced-motion visitors
    if (REDUCED_MOTION) {
      const now = performance.now();
      t0 = now - 9000;
      frame(now);
      cancelAnimationFrame(raf);
      window.addEventListener('resize', () => { resize(); frame(performance.now()); cancelAnimationFrame(raf); });
      return true;
    }

    raf = requestAnimationFrame(frame);

    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(resize, 160);
    });

    // Free the GPU when the tab goes away, and rebuild after a context loss.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });

    return true;
  }

  function startUniverse() {
    const canvas = $('#universe');
    if (!canvas) return;
    let ok = false;
    try { ok = createUniverse(canvas); } catch (err) { console.warn('WebGL failed:', err); ok = false; }
    if (!ok) {
      // Graceful degradation: a CSS nebula instead of the 3D scene.
      document.body.classList.add('no-webgl');
      canvas.style.display = 'none';
    }
  }

  /* =======================================================================
     4. INTERFACE
     ======================================================================= */

  function initInterface() {
    /* ---- navigation ---------------------------------------------------- */
    const nav = $('#nav');
    const toggle = $('#navToggle');
    const links = $('#navLinks');
    const progress = $('#scrollProgress');

    const onScroll = () => {
      const y = window.scrollY || 0;
      nav.classList.toggle('is-stuck', y > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progress) progress.style.width = `${max > 0 ? (y / max) * 100 : 0}%`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (toggle && links) {
      const close = () => {
        links.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      };
      toggle.addEventListener('click', () => {
        const open = links.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      });
      links.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    }

    /* ---- scroll reveals ------------------------------------------------ */
    const items = $$('[data-reveal]');
    if ('IntersectionObserver' in window && !REDUCED_MOTION) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });
      items.forEach((el) => io.observe(el));
    } else {
      items.forEach((el) => el.classList.add('is-visible'));
    }

    /* ---- pointer glow -------------------------------------------------- */
    const glow = $('#cursorGlow');
    if (glow && HAS_HOVER && !REDUCED_MOTION) {
      let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
      let cx = tx, cy = ty, running = false;

      const tick = () => {
        cx += (tx - cx) * 0.09;
        cy += (ty - cy) * 0.09;
        glow.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
        if (Math.abs(tx - cx) > 0.4 || Math.abs(ty - cy) > 0.4) {
          requestAnimationFrame(tick);
        } else { running = false; }
      };

      window.addEventListener('pointermove', (e) => {
        tx = e.clientX; ty = e.clientY;
        glow.classList.add('is-on');
        if (!running) { running = true; requestAnimationFrame(tick); }
      }, { passive: true });
    }

    /* ---- card tilt + holographic sheen --------------------------------- */
    if (HAS_HOVER && !REDUCED_MOTION) {
      $$('.tilt').forEach((card) => {
        let rect = null;
        card.addEventListener('pointerenter', () => { rect = card.getBoundingClientRect(); });
        card.addEventListener('pointermove', (e) => {
          if (!rect) rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const rx = ((y / rect.height) - 0.5) * -7;
          const ry = ((x / rect.width) - 0.5) * 9;
          card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-5px)`;
          card.style.setProperty('--mx', `${x}px`);
          card.style.setProperty('--my', `${y}px`);
        });
        card.addEventListener('pointerleave', () => {
          rect = null;
          card.style.transform = '';
        });
      });
    }

    /* ---- orrery: honour reduced-motion by freezing the SVG timeline ----- */
    if (REDUCED_MOTION) {
      $$('.orrery svg').forEach((svg) => { try { svg.pauseAnimations(); } catch (_) {} });
    }

    /* ---- footer year --------------------------------------------------- */
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();
  }

  /* =======================================================================
     5. LEAD CAPTURE
     ======================================================================= */

  function initForm() {
    const form = $('#leadForm');
    if (!form) return;

    const status = $('#formStatus');
    const btn = $('#submitBtn');
    const fields = {
      company: $('#company'),
      phone: $('#phone'),
      idea: $('#idea')
    };

    const setStatus = (msg, kind = '') => {
      if (!status) return;
      status.className = `form__status is-visible ${kind ? `is-${kind}` : ''}`;
      status.innerHTML = msg;
    };

    const clearStatus = () => {
      if (!status) return;
      status.className = 'form__status';
      status.innerHTML = '';
    };

    const errorFor = (input) => {
      const wrap = input.closest('.field');
      return wrap ? wrap.querySelector('.field__error') : null;
    };

    const markInvalid = (input, message) => {
      const wrap = input.closest('.field');
      if (wrap) wrap.classList.add('is-invalid');
      const slot = errorFor(input);
      if (slot) slot.textContent = message;
      input.setAttribute('aria-invalid', 'true');
    };

    const markValid = (input) => {
      const wrap = input.closest('.field');
      if (wrap) wrap.classList.remove('is-invalid');
      const slot = errorFor(input);
      if (slot) slot.textContent = '';
      input.removeAttribute('aria-invalid');
    };

    // Accepts +91 98765 43210, (044) 1234-5678, 9876543210 …
    const phoneDigits = (v) => v.replace(/\D/g, '');
    const validatePhone = (value) => {
      const digits = phoneDigits(value);
      if (!value.trim()) return 'Please add a phone number so we can reach you.';
      if (!/^[+\d][\d\s().-]{5,24}$/.test(value.trim())) return 'That phone number looks incomplete.';
      if (digits.length < 7 || digits.length > 15) return 'Please enter a valid phone number.';
      return '';
    };
    const validateCompany = (value) =>
      value.trim().length < 2 ? 'Please tell us your company name.' : '';

    // Clear an error the moment the visitor starts fixing it.
    [fields.company, fields.phone].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => {
        if (input.closest('.field')?.classList.contains('is-invalid')) {
          const msg = input === fields.company
            ? validateCompany(input.value)
            : validatePhone(input.value);
          if (msg) markInvalid(input, msg); else markValid(input);
        }
      });
      input.addEventListener('blur', () => {
        if (!input.value.trim()) return;
        const msg = input === fields.company
          ? validateCompany(input.value)
          : validatePhone(input.value);
        if (msg) markInvalid(input, msg); else markValid(input);
      });
    });

    const uuid = () => {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'ref-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    };

    /* Sends the lead. We post as application/x-www-form-urlencoded because
       that is a "simple request" — no CORS preflight — which is what Google
       Apps Script can actually answer. */
    async function send(payload) {
      if (PLACEHOLDER.test(CONFIG.WEBHOOK_URL)) {
        return { ok: true, demo: true };
      }

      const body = new URLSearchParams(payload).toString();
      const base = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        redirect: 'follow'
      };

      // Attempt 1: normal CORS request, so we can read { result: "success" }.
      try {
        const res = await fetch(CONFIG.WEBHOOK_URL, { ...base, mode: 'cors', signal: AbortSignal.timeout?.(CONFIG.SUBMIT_TIMEOUT) });
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* non-JSON is still a POST */ }
        if (data && data.result === 'error') {
          return { ok: false, message: data.message || 'The server rejected the submission.' };
        }
        return { ok: true, verified: true };
      } catch (_) {
        /* Fall through — usually the response was blocked by CORS even though
           the row was written. Retry as an opaque request; the Apps Script
           de-duplicates on `ref`, so a double POST can never create two rows. */
      }

      try {
        await fetch(CONFIG.WEBHOOK_URL, { ...base, mode: 'no-cors' });
        return { ok: true, verified: false };
      } catch (err) {
        return { ok: false, message: 'network' };
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearStatus();

      const hp = form.querySelector('input[name="website_url"]');
      if (hp && hp.value.trim() !== '') return; // silent bot rejection

      const company = fields.company.value.trim();
      const phone = fields.phone.value.trim();

      let firstBad = null;
      const companyErr = validateCompany(company);
      const phoneErr = validatePhone(phone);

      if (companyErr) { markInvalid(fields.company, companyErr); firstBad = firstBad || fields.company; }
      else markValid(fields.company);

      if (phoneErr) { markInvalid(fields.phone, phoneErr); firstBad = firstBad || fields.phone; }
      else markValid(fields.phone);

      if (firstBad) {
        firstBad.focus({ preventScroll: false });
        setStatus('Almost there — please check the fields above.', 'error');
        return;
      }

      btn.classList.add('is-loading');
      btn.disabled = true;

      const payload = {
        ref: uuid(),
        company,
        phone,
        idea: fields.idea ? fields.idea.value.trim() : '',
        source: form.querySelector('input[name="source"]')?.value || 'website',
        page: window.location.href,
        locale: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        submittedAt: new Date().toISOString()
      };

      const result = await send(payload);

      btn.classList.remove('is-loading');
      btn.disabled = false;

      if (result.ok) {
        form.classList.add('is-sent');
        const who = company.length > 34 ? company.slice(0, 34) + '…' : company;
        setStatus(
          result.demo
            ? '<strong>Signal received (preview mode).</strong> Connect your Google Apps Script URL in <code>script.js</code> to capture this lead.'
            : `<strong>Signal received.</strong> Thank you, ${escapeHtml(who)} — we'll be in touch within one business day.`,
          'success'
        );
        form.reset();
        window.setTimeout(() => form.classList.remove('is-sent'), 2200);
      } else {
        setStatus(
          `Something interrupted the transmission. Email us at ` +
          `<a href="mailto:${CONFIG.FALLBACK_EMAIL}">${CONFIG.FALLBACK_EMAIL}</a> and we'll pick it up from there.`,
          'error'
        );
      }
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* =======================================================================
     GO
     ======================================================================= */

  let booted = false;
  function onReady() {
    if (booted) return;
    booted = true;
    boot();
    initInterface();
    initForm();
    // Let the first paint settle before we spin up the GPU.
    if ('requestIdleCallback' in window) requestIdleCallback(startUniverse, { timeout: 900 });
    else setTimeout(startUniverse, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})();
