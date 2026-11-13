/**
 * Dustin appearance center
 *
 * Everything visual lives here (plus custom-effects.css). The backend is stock
 * dufs 0.47.0 — no server-side UI settings, no cookie auth, no custom routes.
 * Preferences are stored per browser in localStorage; every theme keeps its own
 * transparency values. Switching themes is instant and never reloads the page.
 * The canvas is cleared on every frame; no inter-frame trails are kept.
 */
(function () {
    "use strict";

    var boot = window.__DUFS_APPEARANCE__;
    if (!boot) return;

    var STORAGE_KEY = boot.storageKey;
    var SETTINGS_VERSION = 2;
    var THEMES = boot.themes;
    var THEME_IDS = Object.keys(THEMES);
    /* Single source of truth: ids, labels and quick-switch order all derive
       from this one list, so adding an effect can no longer desync them. */
    var EFFECT_ITEMS = [
        { value: "auto", label: "自动" },
        { value: "rain", label: "雨 · 雷电" },
        { value: "snow", label: "雪" },
        { value: "petal", label: "花瓣 · 落叶" },
        { value: "firefly", label: "萤火虫" },
        { value: "starlight", label: "流星 · 星轨" },
        { value: "sunbeam", label: "晨光" },
        { value: "aurora", label: "极光" },
        { value: "ripple", label: "涟漪 · 点击" },
        { value: "off", label: "关闭" }
    ];
    var EFFECT_IDS = EFFECT_ITEMS.map(function (item) { return item.value; });
    var EFFECT_LABELS = {};
    EFFECT_ITEMS.forEach(function (item) { EFFECT_LABELS[item.value] = item.label; });
    /* auto / off are not quick-switch targets */
    var CYCLE_IDS = EFFECT_IDS.filter(function (id) { return id !== "auto" && id !== "off"; });
    var s = boot.settings;
    var root = document.documentElement;
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    /* ------------------------------ persistence ------------------------------ */

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch (e) { /* private mode / quota */ }
    }

    function clamp(value, min, max, fallback) {
        var n = parseFloat(value);
        return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    }

    /* Every retired preference is folded in one place; v makes it idempotent */
    function migrate(saved) {
        if (!saved || typeof saved !== "object" || saved.v === SETTINGS_VERSION) return saved;
        var folded = { storm: "rain", "meteor-shower": "starlight", leaf: "petal" };
        if (folded[saved.effect]) saved.effect = folded[saved.effect];
        if (saved.effect === "fog" || saved.effect === "rain-glass") saved.effect = "auto";
        if (saved.overlay !== undefined) delete saved.overlay;
        saved.v = SETTINGS_VERSION;
        return saved;
    }

    if (!THEMES[s.theme]) s.theme = THEME_IDS[0];
    migrate(s);
    if (EFFECT_IDS.indexOf(s.effect) < 0) s.effect = "auto";
    if (["random", "gradient", "off"].indexOf(s.background) < 0) s.background = "random";
    if (!s.perTheme) s.perTheme = {};
    THEME_IDS.forEach(function (id) {
        var conf = s.perTheme[id] || (s.perTheme[id] = {});
        var base = THEMES[id].defaults;
        conf.panelAlpha = clamp(conf.panelAlpha, 0.2, 0.95, base.panelAlpha);
        conf.panelBlur = clamp(conf.panelBlur, 0, 30, base.panelBlur);
        conf.bgAlpha = clamp(conf.bgAlpha, 0, 0.85, base.bgAlpha);
    });

    function current() {
        return s.perTheme[s.theme];
    }

    function nextThemeId() {
        return THEME_IDS[(THEME_IDS.indexOf(s.theme) + 1) % THEME_IDS.length];
    }

    /* ------------------------------ theme colors ----------------------------- */

    function hexToRgb(hex) {
        var value = String(hex).replace("#", "");
        if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
        var n = parseInt(value, 16);
        if (!isFinite(n)) return "2,136,209";
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(",");
    }

    /*
     * Vuetify injects its theme variables into @layer theme-base on :root AND on
     * .v-theme--light / .v-theme--dark (the .v-application element). An inline
     * variable on :root cannot win against the element's own matched rule, so we
     * inject real rules for both selectors instead. Important + unlayered beats
     * Vuetify's layered, non-important declarations regardless of injection order.
     * The media query keeps the body-level overlays in sync with the system scheme.
     */
    var themeStyle = document.createElement("style");
    themeStyle.id = "dufs-theme-style";
    document.head.appendChild(themeStyle);

    function colorVars(colors) {
        var primary = hexToRgb(colors.primary);
        return "--v-theme-primary:" + primary + "!important;" +
            "--v-theme-secondary:" + hexToRgb(colors.secondary) + "!important;" +
            "--dufs-primary-rgb:" + primary + "!important;";
    }

    function applyThemeColors() {
        var conf = THEMES[s.theme];
        var light = "{" + colorVars(conf.light) + "}";
        var dark = "{" + colorVars(conf.dark) + "}";
        themeStyle.textContent =
            ":root,.v-theme--light" + light +
            ".v-theme--dark" + dark +
            "@media (prefers-color-scheme:dark){:root" + dark + "}";
    }

    /* ------------------------------ css variables ---------------------------- */

    function applyVariables() {
        var conf = current();
        root.style.setProperty("--dufs-panel-alpha", conf.panelAlpha);
        root.style.setProperty("--dufs-panel-blur", conf.panelBlur + "px");
        root.style.setProperty("--dufs-bg-alpha", conf.bgAlpha);
    }

    /* -------------------------------- background ------------------------------ */

    var bgStyle = document.createElement("style");
    bgStyle.id = "dufs-bg-style";
    document.head.appendChild(bgStyle);

    /*
     * Random photo wallpapers. Two independent sources are stacked: if the
     * first fails to load, the next layer shows through, and the theme gradient
     * is the final offline fallback. bgSeed is part of both URLs, so every
     * visit and every click on "随机图片" fetches a different photo.
     */
    function seedNumber() {
        var str = String(s.bgSeed || "dustin");
        var n = 0;
        for (var i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) >>> 0;
        return n || 1;
    }

    function photoLayers() {
        var n = seedNumber();
        return [
            'url("https://www.dmoe.cc/random.php?_dufs=' + n + '")',
            'url("https://picsum.photos/seed/dufs' + n + '/1920/1080")'
        ];
    }

    function gradientLayer() {
        var colors = THEMES[s.theme].gradient;
        return "linear-gradient(135deg, " + colors[0] + ", " + colors[1] + ", " + colors[2] + ")";
    }

    function applyBackground() {
        var shade = "linear-gradient(rgba(8,14,26,var(--dufs-bg-alpha)), rgba(8,14,26,var(--dufs-bg-alpha)))";
        var layers;
        if (s.background === "random") {
            layers = [shade].concat(photoLayers()).concat([gradientLayer()]);
        } else if (s.background === "gradient") {
            layers = [shade, gradientLayer()];
        } else {
            layers = ["none"];
        }
        bgStyle.textContent = ".v-application{background-image:" + layers.join(", ") + " !important;}";
    }

    /* ------------------------------- weather effects -------------------------- */

    var canvas = null;
    var ctx = null;
    var particles = [];
    var effect = "off";
    var showers = [];
    var ripples = [];
    var bursts = [];
    var auroraBands = [];
    var activeList = [];
    var flash = null;
    var flashCooldown = 0;
    var beams = [];
    var rafId = 0;
    var running = false;
    var width = 0;
    var height = 0;
    var dpr = 1;
    var lastFrame = 0;
    var pointerX = null;

    function resolveEffect() {
        if (s.effect === "off") return "off";
        if (s.effect !== "auto") return s.effect;
        if (reduceMotion) return "off";
        var now = new Date();
        var month = now.getMonth() + 1;
        var hour = now.getHours();
        var pool;
        if (hour >= 20 || hour < 5) {
            /* Night: stars and fireflies dominate */
            pool = ["starlight", "starlight", "starlight", "firefly", "aurora", "aurora", "rain", "snow", "petal", "sunbeam"];
        } else if (month === 12 || month <= 2) {
            /* Winter: snow and low sunbeams */
            pool = ["snow", "snow", "sunbeam", "aurora", "aurora", "petal", "rain", "firefly"];
        } else if (month <= 5) {
            /* Spring: petals, showers and soft morning light */
            pool = ["petal", "petal", "petal", "rain", "sunbeam", "sunbeam", "snow", "firefly"];
        } else if (month <= 8) {
            /* Summer: showers (with the occasional lightning strike) */
            pool = ["rain", "rain", "sunbeam", "petal", "starlight", "starlight", "firefly"];
        } else {
            /* Autumn: petals, low sun and late showers */
            pool = ["petal", "petal", "petal", "firefly", "rain", "sunbeam", "snow"];
        }
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function random(min, max) {
        return min + Math.random() * (max - min);
    }

    function spawn(kind, initial) {
        var p = { kind: kind, x: random(0, width), y: initial ? random(0, height) : random(-80, -10) };
        if (kind === "rain") {
            /* Rain and thunderstorm are one mode now: showers + occasional lightning */
            p.len = random(15, 34);
            p.speed = random(13, 24);
            p.alpha = random(0.6, 1);
            p.w = random(1.2, 2.6);
        } else if (kind === "snow") {
            p.r = random(3.6, 9);
            p.speed = random(0.7, 2.2);
            p.alpha = random(0.85, 1);
            p.phase = random(0, Math.PI * 2);
            p.rot = random(0, Math.PI * 2);
            p.rotSpeed = random(-0.02, 0.02);
        } else if (kind === "sunbeam") {
            /* Dust motes drifting inside the light shafts */
            p.x = random(0, width);
            p.y = random(0, height);
            p.r = random(1.3, 3.2);
            p.vx = random(-0.26, 0.26);
            p.vy = random(-0.38, -0.08);
            p.alpha = random(0.7, 1);
            p.phase = random(0, Math.PI * 2);
        } else if (kind === "firefly") {
            p.y = random(0, height);
            p.r = random(2.2, 4.2);
            p.scale = random(0.72, 1.38);
            p.vx = random(-0.45, 0.45);
            p.vy = random(-0.32, 0.32);
            p.phase = random(0, Math.PI * 2);
            p.wing = random(0, Math.PI * 2);
            p.alpha = random(0.75, 1);
        } else if (kind === "starlight") {
            p.y = random(0, height);
            p.r = random(1, 2.6);
            p.phase = random(0, Math.PI * 2);
            p.rate = random(0.0012, 0.0034);
        } else if (kind === "leaf") {
            p.size = random(9, 22);
            p.speed = random(1.6, 3.8);
            p.vx = random(-0.3, 0.9);
            p.phase = random(0, Math.PI * 2);
            p.rot = random(0, Math.PI * 2);
            p.rotSpeed = random(-0.05, 0.05);
            p.flip = random(0, Math.PI * 2);
            p.alpha = random(0.8, 1);
            p.color = s.theme === "theme2" ? "214,116,74" : "236,158,58";
        } else {
            /* petal */
            p.size = random(7, 14);
            p.speed = random(1, 2.6);
            p.phase = random(0, Math.PI * 2);
            p.rot = random(0, Math.PI * 2);
            p.rotSpeed = random(-0.035, 0.035);
            p.flip = random(0, Math.PI * 2);
            p.alpha = random(0.75, 1);
            p.color = s.theme === "theme2" ? "236,120,168" : "255,178,205";
        }
        return p;
    }

    function activeEffects() {
        if (effect === "off") return [];
        return [effect];
    }

    /* Density is deliberately high: desktop browsers have room to spare */
    function densityFor(kind) {
        var area = width * height;
        if (kind === "rain") return Math.max(140, Math.min(520, Math.round(area / 3600)));
        if (kind === "snow") return Math.max(60, Math.min(260, Math.round(area / 9000)));
        if (kind === "sunbeam") return Math.max(120, Math.min(300, Math.round(area / 6500)));
        if (kind === "firefly") return Math.max(40, Math.min(160, Math.round(area / 14000)));
        if (kind === "starlight") return Math.max(110, Math.min(420, Math.round(area / 4800)));
        if (kind === "petal") return Math.max(60, Math.min(240, Math.round(area / 9000)));
        return 0; /* aurora / ripple are full-screen layers */
    }

    function rebuild() {
        if (!canvas) return;
        activeList = activeEffects();
        particles = [];
        showers = [];
        ripples = [];
        bursts = [];
        beams = [];
        auroraBands = [];
        if (!activeList.length) return;
        for (var a = 0; a < activeList.length; a++) {
            var kind = activeList[a];
            var count = densityFor(kind);
            if (kind === "petal") {
                /* Petals and autumn leaves now share one mode */
                var split = Math.round(count * 0.55);
                for (var i = 0; i < split; i++) particles.push(spawn("petal", true));
                for (var j = split; j < count; j++) particles.push(spawn("leaf", true));
            } else {
                for (var k = 0; k < count; k++) particles.push(spawn(kind, true));
            }
        }
        if (activeList.indexOf("sunbeam") >= 0) {
            for (var b = 0; b < 7; b++) {
                beams.push({
                    x: width * (0.06 + b * 0.14),
                    w: random(width * 0.1, width * 0.24),
                    phase: random(0, Math.PI * 2)
                });
            }
        }
        if (activeList.indexOf("aurora") >= 0) {
            for (var c = 0; c < 7; c++) {
                auroraBands.push({
                    x: width * (0.04 + c * 0.145),
                    w: random(width * 0.1, width * 0.24),
                    phase: random(0, Math.PI * 2),
                    speed: random(0.6, 1.35),
                    warm: c % 2
                });
            }
        }
        /* A couple of idle rings hint at the effect; clicks create the rest */
        if (activeList.indexOf("ripple") >= 0) {
            for (var r = 0; r < 2; r++) {
                ripples.push({
                    x: random(width * 0.08, width * 0.92),
                    y: random(height * 0.08, height * 0.92),
                    r: random(20, Math.max(width, height) * 0.42),
                    life: random(0.45, 1)
                });
            }
        }
        if (activeList.indexOf("starlight") >= 0) {
            for (var m = 0; m < 6; m++) {
                showers.push({
                    x: random(width * 0.15, width * 1.1),
                    y: random(-height * 0.05, height * 0.55),
                    len: random(90, 380),
                    speed: random(10, 23),
                    life: random(0.55, 1)
                });
            }
        }
    }

    function resize() {
        if (!canvas) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rebuild();
    }

    function drawRain(p, wind, dt, lit) {
        p.y += p.speed * dt;
        p.x += wind * p.speed * 0.3 * dt;
        if (p.y > height + 30 || p.x > width + 40) {
            p.y = random(-60, -10);
            p.x = random(-20, width);
        }
        /* Lightning briefly lights up the falling rain as well */
        var a = Math.min(1, p.alpha + lit * 0.4);
        ctx.strokeStyle = "rgba(" + (lit > 0 ? "235,246,255" : "196,228,255") + "," + a.toFixed(3) + ")";
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * 0.12 + wind * p.len * 0.5, p.y + p.len);
        ctx.stroke();
    }

    /* Six-armed dendrite: a cool underlay plus a crisp white crystal on top */
    function drawSnowflake(r, alpha) {
        ctx.lineCap = "round";
        for (var pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass === 0
                ? "rgba(120,170,220," + (alpha * 0.55).toFixed(3) + ")"
                : "rgba(255,255,255," + alpha.toFixed(3) + ")";
            ctx.lineWidth = pass === 0 ? Math.max(1.4, r * 0.42) : Math.max(0.8, r * 0.2);
            for (var i = 0; i < 6; i++) {
                var a = i * Math.PI / 3;
                var ca = Math.cos(a), sa = Math.sin(a);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(ca * r, sa * r);
                ctx.stroke();
                for (var j = 1; j <= 2; j++) {
                    var d = r * (0.38 + j * 0.24);
                    var bx = ca * d, by = sa * d;
                    var bl = r * (0.34 - j * 0.07);
                    ctx.beginPath();
                    ctx.moveTo(bx, by);
                    ctx.lineTo(bx + Math.cos(a + Math.PI / 3) * bl, by + Math.sin(a + Math.PI / 3) * bl);
                    ctx.moveTo(bx, by);
                    ctx.lineTo(bx + Math.cos(a - Math.PI / 3) * bl, by + Math.sin(a - Math.PI / 3) * bl);
                    ctx.stroke();
                }
            }
        }
    }

    function drawSnow(p, wind, ts, dt) {
        p.y += p.speed * dt;
        p.x += (Math.sin(ts / 1400 + p.phase) * 0.55 + wind * 0.45) * dt;
        p.rot += p.rotSpeed * dt;
        if (p.y > height + 20) {
            p.y = random(-50, -8);
            p.x = random(0, width);
        }
        if (p.x > width + 20) p.x = -20;
        if (p.x < -20) p.x = width + 20;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        drawSnowflake(p.r, p.alpha);
        ctx.restore();
    }

    /* Pointed bezier petal with a soft vertical gradient and a central vein */
    function drawPetalShape(size, color, alpha) {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.bezierCurveTo(size * 0.82, -size * 0.62, size * 0.78, size * 0.5, 0, size);
        ctx.bezierCurveTo(-size * 0.78, size * 0.5, -size * 0.82, -size * 0.62, 0, -size);
        ctx.closePath();
        var g = ctx.createLinearGradient(0, -size, 0, size);
        g.addColorStop(0, "rgba(" + color + "," + (alpha * 0.5).toFixed(3) + ")");
        g.addColorStop(0.55, "rgba(" + color + "," + alpha.toFixed(3) + ")");
        g.addColorStop(1, "rgba(255,240,246," + (alpha * 0.92).toFixed(3) + ")");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = "rgba(150,60,100," + (alpha * 0.38).toFixed(3) + ")";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255," + (alpha * 0.45).toFixed(3) + ")";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.72);
        ctx.quadraticCurveTo(size * 0.14, 0, 0, size * 0.78);
        ctx.stroke();
    }

    function drawPetal(p, wind, ts, dt) {
        p.y += p.speed * dt;
        p.x += (Math.sin(ts / 1200 + p.phase) * 0.9 + wind * 0.7) * dt;
        p.rot += p.rotSpeed * dt;
        p.flip += 0.02 * dt;
        if (p.y > height + 24) {
            p.y = random(-50, -10);
            p.x = random(0, width);
        }
        if (p.x > width + 24) p.x = -20;
        if (p.x < -24) p.x = width + 20;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flip) * 0.55 + 0.45);
        drawPetalShape(p.size, p.color, p.alpha);
        ctx.restore();
    }

    /* A real firefly: translucent beating wings, dark body, antennae and a
       breathing lantern. The halo is a radial gradient (not a solid disc), so
       the glow never smears the file list behind it. */
    function drawFirefly(p, wind, ts, dt) {
        p.x += (p.vx + Math.sin(ts / 900 + p.phase) * 0.42 + wind * 0.15) * dt;
        p.y += (p.vy + Math.cos(ts / 1100 + p.phase) * 0.32) * dt;
        if (p.x < -30) p.x = width + 30;
        if (p.x > width + 30) p.x = -30;
        if (p.y < -30) p.y = height + 30;
        if (p.y > height + 30) p.y = -30;

        var k = p.r * (p.scale || 1);
        /* Each insect has its own on/off rhythm and its own wing beat phase */
        var pulse = Math.pow(Math.max(0, Math.sin(ts / 420 + p.phase)), 2);
        var glow = p.alpha * (0.34 + 0.66 * pulse);
        var flap = Math.abs(Math.sin(ts / 38 + (p.wing || 0)));

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx) * 0.12 + Math.sin(ts / 900 + p.phase) * 0.18);

        var halo = ctx.createRadialGradient(0, k * 0.95, 0, 0, k * 0.95, k * 6.4);
        halo.addColorStop(0, "rgba(214,255,150," + (glow * 0.5).toFixed(3) + ")");
        halo.addColorStop(0.32, "rgba(255,228,120," + (glow * 0.2).toFixed(3) + ")");
        halo.addColorStop(1, "rgba(255,214,90,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, k * 0.95, k * 6.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = Math.max(0.6, k * 0.16);
        for (var side = -1; side <= 1; side += 2) {
            ctx.save();
            ctx.scale(side, 1);
            ctx.rotate(-0.62 + flap * 0.82);
            ctx.fillStyle = "rgba(222,246,255," + (0.16 + flap * 0.16).toFixed(3) + ")";
            ctx.strokeStyle = "rgba(236,252,255," + (0.24 + flap * 0.18).toFixed(3) + ")";
            ctx.beginPath();
            ctx.ellipse(k * 1.15, -k * 0.32, k * 1.42, k * 0.58, -0.22, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        ctx.fillStyle = "rgba(32,42,28,.94)";
        ctx.beginPath();
        ctx.ellipse(0, 0, k * 0.62, k * 1.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(124,152,84,.5)";
        ctx.beginPath();
        ctx.ellipse(-k * 0.18, -k * 0.08, k * 0.2, k * 0.86, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(26,34,24,.96)";
        ctx.beginPath();
        ctx.arc(0, -k * 1.22, k * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(214,240,168,.62)";
        ctx.lineWidth = Math.max(0.6, k * 0.14);
        for (var a = -1; a <= 1; a += 2) {
            ctx.beginPath();
            ctx.moveTo(a * k * 0.2, -k * 1.5);
            ctx.quadraticCurveTo(a * k * 0.92, -k * 2.16, a * k * 1.3, -k * 1.86);
            ctx.stroke();
        }

        ctx.fillStyle = "rgba(226,255,150," + glow.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(0, k * 1.02, k * 0.76, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,232," + (glow * 0.92).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(0, k * 1.02, k * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawStar(p, ts) {
        var a = 0.5 + 0.5 * Math.abs(Math.sin(ts * p.rate + p.phase));
        ctx.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    }

    /* --------------------------- full-screen effects -------------------------- */

    /* Aurora: wide vertical light curtains with a slow sideways sway */
    function drawAurora(ts) {
        for (var b = 0; b < auroraBands.length; b++) {
            var band = auroraBands[b];
            var t = ts / 1400 * band.speed + band.phase;
            var x = band.x + Math.sin(t * 0.55) * width * 0.07;
            var tint = band.warm
                ? (s.theme === "theme2" ? "236,140,205" : "156,124,255")
                : (s.theme === "theme2" ? "118,224,208" : "86,232,192");
            var g = ctx.createLinearGradient(x, 0, x, height * 0.82);
            g.addColorStop(0, "rgba(" + tint + ",0)");
            g.addColorStop(0.16, "rgba(" + tint + ",.46)");
            g.addColorStop(0.52, "rgba(" + tint + ",.26)");
            g.addColorStop(1, "rgba(" + tint + ",0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(x - band.w * 0.5, -20);
            ctx.lineTo(x + band.w * 0.5, -20);
            for (var q = 0; q <= 12; q++) {
                var u = q / 12;
                ctx.lineTo(x + band.w * 0.5 + Math.sin(u * 5 + t) * band.w * 0.24, height * 0.82 * u);
            }
            for (var j = 12; j >= 0; j--) {
                var v = j / 12;
                ctx.lineTo(x - band.w * 0.5 + Math.sin(v * 5 + t + 1.2) * band.w * 0.24, height * 0.82 * v);
            }
            ctx.closePath();
            ctx.fill();
        }
    }

    /* Short-lived sparkles emitted on pointer clicks */
    function spawnBurst(x, y, kind) {
        /* Cap the backlog: rapid clicking must not grow the array without bound */
        if (bursts.length > 224) bursts.splice(0, bursts.length - 224);
        var tint = kind === "petal" ? "255,190,214" : kind === "firefly" ? "214,255,150" :
            kind === "snow" ? "220,240,255" : kind === "aurora" ? "140,235,205" : "226,238,255";
        for (var i = 0; i < 16; i++) {
            var a = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
            var speed = random(1.6, 5.2);
            bursts.push({
                x: x, y: y,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                life: 1,
                tint: tint
            });
        }
    }

    function drawBursts(dt) {
        for (var i = bursts.length - 1; i >= 0; i--) {
            var b = bursts[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.vx *= 0.97;
            b.vy *= 0.97;
            b.life -= 0.022 * dt;
            if (b.life <= 0) { bursts.splice(i, 1); continue; }
            ctx.fillStyle = "rgba(" + b.tint + "," + (b.life * 0.28).toFixed(3) + ")";
            ctx.beginPath();
            ctx.arc(b.x, b.y, 9 * b.life, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(" + b.tint + "," + b.life.toFixed(3) + ")";
            ctx.beginPath();
            ctx.arc(b.x, b.y, 2.6 * b.life, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* Ripples: pointer-driven, with a faint idle trickle */
    function spawnRipple(x, y) {
        if (ripples.length >= 26) return;
        for (var i = 0; i < 2; i++) {
            ripples.push({ x: x, y: y, r: 6 + i * 22, life: 1 });
        }
    }

    function tickRipples(dt) {
        if (ripples.length < 20 && Math.random() < 0.012) {
            ripples.push({ x: random(0, width), y: random(0, height), r: 4, life: 1 });
        }
        for (var i = ripples.length - 1; i >= 0; i--) {
            var q = ripples[i];
            q.r += (2.6 + q.r * 0.014) * dt;
            q.life -= 0.006 * dt;
            if (q.life <= 0 || q.r > Math.max(width, height) * 0.95) ripples.splice(i, 1);
        }
    }

    function drawRipples() {
        ctx.lineWidth = 1.8;
        for (var i = 0; i < ripples.length; i++) {
            var q = ripples[i];
            ctx.strokeStyle = "rgba(198,232,255," + (q.life * 0.55).toFixed(3) + ")";
            for (var k = 0; k < 3; k++) {
                var r = q.r - k * 18;
                if (r < 2) continue;
                ctx.beginPath();
                ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    /* Starlight: stars plus many gradient-tailed streaks of mixed length */
    function drawShower(dt) {
        if (showers.length < 20 && Math.random() < 0.22) {
            showers.push({
                x: random(width * 0.1, width * 1.15),
                y: random(-height * 0.1, height * 0.6),
                len: random(90, 380),
                speed: random(10, 23),
                life: 1
            });
        }
        for (var i = showers.length - 1; i >= 0; i--) {
            var m = showers[i];
            var tx = m.x + m.len, ty = m.y - m.len * 0.42;
            var g = ctx.createLinearGradient(m.x, m.y, tx, ty);
            g.addColorStop(0, "rgba(255,255,255," + (m.life * 0.95).toFixed(3) + ")");
            g.addColorStop(0.35, "rgba(176,220,255," + (m.life * 0.5).toFixed(3) + ")");
            g.addColorStop(1, "rgba(176,220,255,0)");
            ctx.strokeStyle = g;
            ctx.lineWidth = 3.4;
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255," + m.life.toFixed(3) + ")";
            ctx.beginPath();
            ctx.arc(m.x, m.y, 2.8, 0, Math.PI * 2);
            ctx.fill();
            m.x -= m.speed * dt;
            m.y += m.speed * 0.42 * dt;
            m.life -= 0.008 * dt;
            if (m.life <= 0 || m.x + m.len < 0 || m.y > height) showers.splice(i, 1);
        }
    }

    /* Veined autumn leaves tumbling on a diagonal wind */
    function drawLeafShape(size, color, alpha) {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.bezierCurveTo(size * 0.95, -size * 0.55, size * 0.72, size * 0.62, 0, size);
        ctx.bezierCurveTo(-size * 0.72, size * 0.62, -size * 0.95, -size * 0.55, 0, -size);
        ctx.closePath();
        var g = ctx.createLinearGradient(0, -size, 0, size);
        g.addColorStop(0, "rgba(" + color + "," + (alpha * 0.6).toFixed(3) + ")");
        g.addColorStop(1, "rgba(255,214,120," + alpha.toFixed(3) + ")");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = "rgba(150,74,32," + (alpha * 0.5).toFixed(3) + ")";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,240,196," + (alpha * 0.55).toFixed(3) + ")";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.85);
        ctx.lineTo(0, size * 0.9);
        for (var i = 1; i <= 3; i++) {
            var d = -size * 0.5 + i * size * 0.32;
            ctx.moveTo(0, d);
            ctx.lineTo(size * 0.42, d - size * 0.24);
            ctx.moveTo(0, d);
            ctx.lineTo(-size * 0.42, d - size * 0.24);
        }
        ctx.stroke();
    }

    function drawLeaf(p, wind, ts, dt) {
        p.y += p.speed * dt;
        p.x += (Math.sin(ts / 1100 + p.phase) * 1.4 + wind * 1.2 + p.vx) * dt;
        p.rot += p.rotSpeed * dt;
        p.flip += 0.035 * dt;
        if (p.y > height + 30 || p.x > width + 40) {
            p.y = random(-60, -10);
            p.x = random(-20, width);
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flip) * 0.6 + 0.4);
        drawLeafShape(p.size, p.color, p.alpha);
        ctx.restore();
    }

    /* A slow, very soft shadow drifting over every wallpaper and effect */
    function drawCloudShadow(ts) {
        if (reduceMotion) return;
        var x = width * (0.4 + 0.28 * Math.sin(ts / 26000));
        var y = height * (0.4 + 0.16 * Math.cos(ts / 31000));
        var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(width, height) * 0.7);
        g.addColorStop(0, "rgba(8,16,32,.16)");
        g.addColorStop(1, "rgba(8,16,32,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
    }

    /* Angled light shafts; the dust motes are drawn on top of these */
    function drawBeams(ts) {
        for (var b = 0; b < beams.length; b++) {
            var beam = beams[b];
            var x = beam.x + Math.sin(ts / 11000 + beam.phase) * width * 0.05;
            var g = ctx.createLinearGradient(x, 0, x + width * 0.22, height);
            g.addColorStop(0, "rgba(255,246,214,.32)");
            g.addColorStop(0.55, "rgba(255,246,214,.14)");
            g.addColorStop(1, "rgba(255,246,214,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(x - beam.w * 0.5, -10);
            ctx.lineTo(x + beam.w * 0.5, -10);
            ctx.lineTo(x + beam.w * 1.6 + width * 0.22, height + 10);
            ctx.lineTo(x - beam.w * 0.6 + width * 0.22, height + 10);
            ctx.closePath();
            ctx.fill();
        }
    }

    function drawMote(p, ts, dt) {
        p.x += (p.vx + Math.sin(ts / 2400 + p.phase) * 0.12) * dt;
        p.y += (p.vy + Math.cos(ts / 3100 + p.phase) * 0.08) * dt;
        if (p.y < -10) p.y = height + 10;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        var a = p.alpha * (0.7 + 0.3 * Math.abs(Math.sin(ts / 1300 + p.phase)));
        ctx.fillStyle = "rgba(255,248,222," + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    }

    /* --------------------- lightning (part of the rain mode) ------------------ */

    function makeBolt(x0, y0, x1, y1) {
        var segs = 7 + Math.floor(Math.random() * 5);
        var points = [];
        for (var i = 0; i <= segs; i++) {
            var t = i / segs;
            var jitter = (i === 0 || i === segs) ? 0 : (Math.random() - 0.5) * 46 * (1 - Math.abs(t - 0.5));
            points.push({ x: x0 + (x1 - x0) * t + jitter, y: y0 + (y1 - y0) * t });
        }
        return points;
    }

    function spawnFlash() {
        var x = random(width * 0.18, width * 0.82);
        var main = makeBolt(x, -20, x + random(-140, 140), random(height * 0.4, height * 0.85));
        var bolts = [main];
        for (var i = 0; i < 3; i++) {
            /* main.length is 8..12 and this span already stays in range; the
               explicit clamp is defence against a future change to the segment
               count, so a bad index can never stop the animation loop. */
            var at = 2 + Math.floor(Math.random() * (main.length - 4));
            var p = main[Math.min(at, main.length - 1)];
            bolts.push(makeBolt(p.x, p.y, p.x + random(-200, 200), p.y + random(70, 200)));
        }
        flash = { life: 1, bolts: bolts };
        flashCooldown = random(70, 170);
    }

    function flashEnv() {
        if (!flash) return 0;
        /* Fast decay with a short oscillation reads as a double strike */
        return Math.pow(flash.life, 0.7) * (0.62 + 0.38 * Math.abs(Math.sin(flash.life * 19)));
    }

    function tickFlash(dt) {
        /* Photosensitivity: never flash when reduced motion is requested */
        if (reduceMotion) { flash = null; return; }
        if (flashCooldown > 0) flashCooldown -= dt;
        if (!flash && flashCooldown <= 0 && Math.random() < 0.0065) spawnFlash();
        if (flash) {
            flash.life -= 0.042 * dt;
            if (flash.life <= 0) flash = null;
        }
    }

    function paintFlash(env) {
        if (!flash || env <= 0) return;
        ctx.fillStyle = "rgba(226,238,255," + (env * 0.45).toFixed(3) + ")";
        ctx.fillRect(0, 0, width, height);
        ctx.save();
        ctx.strokeStyle = "rgba(244,250,255," + Math.min(1, env * 1.25).toFixed(3) + ")";
        ctx.lineWidth = 3.2;
        ctx.shadowBlur = 26;
        ctx.shadowColor = "rgba(160,200,255,.95)";
        for (var b = 0; b < flash.bolts.length; b++) {
            var pts = flash.bolts[b];
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function frame(ts) {
        if (!running) return;
        var dt = lastFrame ? Math.min(2.2, (ts - lastFrame) / 16.67) : 1;
        lastFrame = ts;
        /* Always repaint from a clean canvas. Keeping a faded copy of the
           previous frame made the whole screen look blurry, so no trails. */
        ctx.clearRect(0, 0, width, height);
        drawCloudShadow(ts);
        /* activeList is fixed for the whole frame, so resolve these once */
        var hasAurora = activeList.indexOf("aurora") >= 0;
        var hasRipple = activeList.indexOf("ripple") >= 0;
        var hasSunbeam = activeList.indexOf("sunbeam") >= 0;
        var hasRain = activeList.indexOf("rain") >= 0;
        var hasStarlight = activeList.indexOf("starlight") >= 0;
        if (hasAurora) drawAurora(ts);
        if (hasRipple) { tickRipples(dt); drawRipples(); }
        if (hasSunbeam) drawBeams(ts);
        var wind = Math.sin(ts / 4200) * 0.6 + (pointerX === null ? 0 : (pointerX / width - 0.5) * 1.2);
        if (hasRain) tickFlash(dt);
        else flash = null;
        var lit = flashEnv();
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            if (p.kind === "rain") drawRain(p, wind, dt, lit);
            else if (p.kind === "snow") drawSnow(p, wind, ts, dt);
            else if (p.kind === "sunbeam") drawMote(p, ts, dt);
            else if (p.kind === "petal") drawPetal(p, wind, ts, dt);
            else if (p.kind === "leaf") drawLeaf(p, wind, ts, dt);
            else if (p.kind === "firefly") drawFirefly(p, wind, ts, dt);
            else if (p.kind === "starlight") drawStar(p, ts);
        }
        if (hasStarlight) drawShower(dt);
        if (bursts.length) drawBursts(dt);
        if (hasRain) paintFlash(lit);
        rafId = window.requestAnimationFrame(frame);
    }

    function stop() {
        running = false;
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
        lastFrame = 0;
    }

    function start() {
        if (!canvas || running || !activeList.length) return;
        running = true;
        lastFrame = 0;
        rafId = window.requestAnimationFrame(frame);
    }

    function setEffect(next) {
        effect = next;
        if (!canvas) return;
        stop();
        flash = null;
        activeList = activeEffects();
        /* Give a fresh shower a moment before its first strike */
        flashCooldown = activeList.indexOf("rain") >= 0 ? 40 : 0;
        if (!activeList.length) {
            ctx.clearRect(0, 0, width, height);
            canvas.hidden = true;
            return;
        }
        canvas.hidden = false;
        resize();
        start();
    }

    function initWeather() {
        canvas = document.createElement("canvas");
        canvas.id = "dufs-weather";
        canvas.setAttribute("aria-hidden", "true");
        document.body.appendChild(canvas);
        ctx = canvas.getContext("2d");
        if (!ctx) return;

        var resizeTimer = 0;
        window.addEventListener("resize", function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                if (activeList.length) resize();
            }, 160);
        });
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) stop();
            else start();
        });
        document.addEventListener("pointerdown", function (e) {
            var kind = activeList[0];
            if (!kind) return;
            if (kind === "ripple") { spawnRipple(e.clientX, e.clientY); return; }
            if (kind === "rain") {
                if (!reduceMotion) spawnFlash();
                spawnBurst(e.clientX, e.clientY, "rain");
                return;
            }
            spawnBurst(e.clientX, e.clientY, kind);
        }, { passive: true });
        if (finePointer) {
            window.addEventListener("pointermove", function (e) {
                pointerX = e.clientX;
            }, { passive: true });
        }
        setEffect(resolveEffect());
    }

    /* ------------------------------- settings panel --------------------------- */

    var GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7zm7.4-2.6l1.8-1.4-1.9-3.3-2.2.8a7.6 7.6 0 0 0-1.6-.9L15.2 5h-3.8l-.3 2.6a7.6 7.6 0 0 0-1.6.9l-2.2-.8-1.9 3.3 1.8 1.4a7.9 7.9 0 0 0 0 1.8l-1.8 1.4 1.9 3.3 2.2-.8c.5.4 1 .7 1.6.9l.3 2.6h3.8l.3-2.6c.6-.2 1.1-.5 1.6-.9l2.2.8 1.9-3.3-1.8-1.4c.1-.6.1-1.2 0-1.8z"/></svg>';

    var THEME_ITEMS = THEME_IDS.map(function (id, i) {
        return {
            value: id,
            label: "主题 " + (i + 1) + " · " + THEMES[id].name,
            color: THEMES[id].light.primary,
            cls: "dufs-theme-btn"
        };
    });
    /* EFFECT_ITEMS lives at the top of this file as the single source of truth. */
    var BG_ITEMS = [
        { value: "random", label: "随机图片" },
        { value: "gradient", label: "主题渐变" },
        { value: "off", label: "纯色" }
    ];
    var SLIDERS = [
        { id: "dufs-alpha", key: "panelAlpha", format: function (v) { return Math.round(v * 100) + "%"; } },
        { id: "dufs-blur", key: "panelBlur", format: function (v) { return Math.round(v) + "px"; } },
        { id: "dufs-shade", key: "bgAlpha", format: function (v) { return Math.round(v * 100) + "%"; } }
    ];

    var topbarControls = null;
    var panel = null;
    var themeButton = null;
    var effectButton = null;
    var effectToast = null;
    var toastTimer = 0;

    function segmentHtml(items, value) {
        return items.map(function (item) {
            var swatch = item.color
                ? '<span class="dufs-swatch" style="background:' + item.color + '"></span>'
                : "";
            return '<button type="button" class="' + (item.cls || "") + '" data-value="' + item.value +
                '" aria-pressed="' + (item.value === value ? "true" : "false") + '">' +
                swatch + "<span>" + item.label + "</span></button>";
        }).join("");
    }

    function syncSegment(id, value) {
        var box = panel.querySelector("#" + id);
        if (!box) return;
        var buttons = box.querySelectorAll("button[data-value]");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute("aria-pressed", buttons[i].dataset.value === value ? "true" : "false");
        }
    }

    function bindSegment(id, items, getter, setter) {
        var box = panel.querySelector("#" + id);
        box.innerHTML = segmentHtml(items, getter());
        box.addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-value]");
            if (!btn) return;
            setter(btn.dataset.value);
            syncSegment(id, getter());
        });
    }

    function refreshSliders() {
        SLIDERS.forEach(function (item) {
            var input = panel.querySelector("#" + item.id);
            var output = panel.querySelector("#" + item.id + "-value-2");
            if (input) input.value = current()[item.key];
            if (output) output.textContent = item.format(current()[item.key]);
        });
    }

    function bindSlider(item) {
        var input = panel.querySelector("#" + item.id);
        var output = panel.querySelector("#" + item.id + "-value-2");
        input.addEventListener("input", function () {
            current()[item.key] = parseFloat(input.value);
            output.textContent = item.format(current()[item.key]);
            applyVariables();
            applyBackground();
            save();
        });
    }

    function refreshPanel() {
        if (!panel) return;
        syncSegment("dufs-themes", s.theme);
        syncSegment("dufs-effects", s.effect);
        syncSegment("dufs-backgrounds", s.background);
        updateEffectButton();
        refreshSliders();
        var label = panel.querySelector("#dufs-current-theme");
        if (label) label.textContent = THEMES[s.theme].name;
    }

    /* ------------------------------ topbar controls --------------------------- */

    function effectLabel(id) {
        return EFFECT_LABELS[id] || "自动";
    }

    function updateEffectButton() {
        if (!effectButton) return;
        var label = effectButton.querySelector(".dufs-effect-label");
        if (label) label.textContent = effectLabel(s.effect);
        effectButton.title = "单击切换全屏动效（当前：" + effectLabel(s.effect) + "）";
        effectButton.setAttribute("aria-label", effectButton.title);
    }

    function showEffectToast(text) {
        if (!effectToast) return;
        effectToast.textContent = text;
        effectToast.classList.add("is-visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            effectToast.classList.remove("is-visible");
        }, 1500);
    }

    function cycleEffect() {
        var idx = CYCLE_IDS.indexOf(s.effect);
        var next = CYCLE_IDS[(idx + 1 + CYCLE_IDS.length) % CYCLE_IDS.length];
        s.effect = next;
        save();
        setEffect(resolveEffect());
        refreshPanel();
        updateEffectButton();
        showEffectToast(effectLabel(next));
    }

    function updateTopbarButton() {
        if (!themeButton) return;
        var name = THEMES[s.theme].name;
        var next = THEMES[nextThemeId()].name;
        var label = themeButton.querySelector(".dufs-switch-label");
        if (label) label.textContent = name;
        var dots = themeButton.querySelectorAll(".dufs-switch-dot");
        if (dots.length === THEME_IDS.length) {
            THEME_IDS.forEach(function (id, i) {
                dots[i].classList.toggle("is-active", id === s.theme);
            });
        }
        themeButton.title = "点击切换到 " + next;
        themeButton.setAttribute("aria-label", themeButton.title);
    }

    /*
     * The gear and the theme switch live together in one group inside Vuetify's
     * #app-bar-append (the app bar's append slot). Vue mounts that div later and
     * may replace it on re-render, so re-attach on body mutations. If the bar is
     * gone, pin the group to the top edge rather than floating it bottom-right.
     */
    function ensureTopbarMount() {
        var target = document.getElementById("app-bar-append");
        var inBar = target && topbarControls.parentNode === target &&
            !topbarControls.classList.contains("dufs-topbar--floating");
        var floating = !target && topbarControls.parentNode === document.body &&
            topbarControls.classList.contains("dufs-topbar--floating") &&
            document.body.contains(topbarControls);
        if (inBar || floating) return;

        if (target) {
            target.appendChild(topbarControls);
            topbarControls.classList.remove("dufs-topbar--floating");
        } else {
            document.body.appendChild(topbarControls);
            topbarControls.classList.add("dufs-topbar--floating");
        }
    }

    function initTopbarControls() {
        topbarControls = document.createElement("div");
        topbarControls.id = "dufs-topbar-controls";
        document.body.appendChild(topbarControls);
        ensureTopbarMount();
        if (window.MutationObserver) {
            new window.MutationObserver(ensureTopbarMount).observe(document.body, {
                childList: true, subtree: true
            });
        }
    }

    function initTopbarSwitch() {
        themeButton = document.createElement("button");
        themeButton.id = "dufs-theme-switch";
        themeButton.type = "button";
        themeButton.innerHTML =
            '<span class="dufs-switch-dot" style="background:' + THEMES.theme1.light.primary + '"></span>' +
            '<span class="dufs-switch-dot" style="background:' + THEMES.theme2.light.primary + '"></span>' +
            '<span class="dufs-switch-label"></span>';
        themeButton.addEventListener("click", function () {
            switchTheme(nextThemeId());
        });
        updateTopbarButton();
        topbarControls.appendChild(themeButton);

        effectButton = document.createElement("button");
        effectButton.id = "dufs-effect-switch";
        effectButton.type = "button";
        effectButton.innerHTML =
            '<span class="dufs-effect-icon" aria-hidden="true"></span>' +
            '<span class="dufs-effect-label"></span>';
        effectButton.addEventListener("click", cycleEffect);
        updateEffectButton();
        topbarControls.appendChild(effectButton);

        effectToast = document.createElement("div");
        effectToast.id = "dufs-effect-toast";
        effectToast.setAttribute("aria-live", "polite");
        document.body.appendChild(effectToast);
    }

    /* ------------------------------ theme switching --------------------------- */

    function switchTheme(id) {
        if (!THEMES[id] || id === s.theme) return;
        s.theme = id;
        applyThemeColors();
        applyVariables();
        applyBackground();
        if (s.effect === "auto") setEffect(resolveEffect());
        else if (activeList.length) rebuild();
        save();
        refreshPanel();
        updateTopbarButton();
    }

    /* --------------------------------- panel ---------------------------------- */

    function initPanel() {
        var toggle = document.createElement("button");
        toggle.id = "dufs-appearance-toggle";
        toggle.type = "button";
        toggle.title = "外观设置";
        toggle.setAttribute("aria-label", "外观设置");
        toggle.innerHTML = GEAR;
        topbarControls.appendChild(toggle);

        panel = document.createElement("div");
        panel.id = "dufs-appearance-panel";
        panel.hidden = true;
        panel.innerHTML =
            '<div class="dufs-head"><span class="dufs-title">Dustin · 外观设置</span>' +
            '<button type="button" class="dufs-close" aria-label="关闭">×</button></div>' +
            '<div class="dufs-sub">每套主题独立保存透明度 · 顶栏按钮可一键切换</div>' +

            '<div class="dufs-group"><div class="dufs-label"><span>主题</span><small id="dufs-current-theme"></small></div>' +
            '<div class="dufs-seg" id="dufs-themes"></div></div>' +

            '<div class="dufs-group"><div class="dufs-label"><span>天气粒子</span><small>自动按季节与时段随机</small></div>' +
            '<div class="dufs-seg" id="dufs-effects"></div></div>' +

            '<div class="dufs-group"><div class="dufs-label"><span>背景</span></div>' +
            '<div class="dufs-seg" id="dufs-backgrounds"></div></div>' +

            '<div class="dufs-group"><div class="dufs-label"><span>面板透明度</span><small>仅影响当前主题</small></div>' +
            '<div class="dufs-row"><input type="range" id="dufs-alpha" min="0.2" max="0.95" step="0.01"><span class="dufs-value" id="dufs-alpha-value-2"></span></div></div>' +

            '<div class="dufs-group"><div class="dufs-label"><span>玻璃模糊</span><small>仅影响当前主题</small></div>' +
            '<div class="dufs-row"><input type="range" id="dufs-blur" min="0" max="30" step="1"><span class="dufs-value" id="dufs-blur-value-2"></span></div></div>' +

            '<div class="dufs-group"><div class="dufs-label"><span>背景透明度</span><small>数值越大背景图越淡</small></div>' +
            '<div class="dufs-row"><input type="range" id="dufs-shade" min="0" max="0.85" step="0.01"><span class="dufs-value" id="dufs-shade-value-2"></span></div></div>' +

            '<div class="dufs-actions"><button type="button" id="dufs-reset">恢复默认</button></div>' +
            '<div class="dufs-hint">Esc 关闭面板。选「涟漪」后点击屏幕任意位置产生水波；点「随机图片」即换一张壁纸；系统开启「减弱动态效果」时自动天气关闭，雨也不会闪电。</div>';
        document.body.appendChild(panel);

        toggle.addEventListener("click", function () {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) refreshPanel();
        });
        panel.querySelector(".dufs-close").addEventListener("click", function () {
            panel.hidden = true;
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") panel.hidden = true;
        });

        bindSegment("dufs-themes", THEME_ITEMS,
            function () { return s.theme; },
            function (value) { switchTheme(value); });

        bindSegment("dufs-effects", EFFECT_ITEMS,
            function () { return s.effect; },
            function (value) {
                s.effect = value;
                save();
                setEffect(resolveEffect());
                updateEffectButton();
                showEffectToast(effectLabel(value));
            });

        bindSegment("dufs-backgrounds", BG_ITEMS,
            function () { return s.background; },
            function (value) {
                s.background = value;
                s.bgSeed = Math.random().toString(36).slice(2);
                save();
                applyBackground();
            });

        SLIDERS.forEach(bindSlider);

        panel.querySelector("#dufs-reset").addEventListener("click", function () {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            window.location.reload();
        });

        refreshPanel();
    }

    /* --------------------------------- boot ---------------------------------- */

    applyThemeColors();
    applyVariables();
    applyBackground();
    initWeather();
    initTopbarControls();
    initTopbarSwitch();
    initPanel();
    save(); /* persist SETTINGS_VERSION after migration */
})();
