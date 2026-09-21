// difusion.js — réplica en JavaScript de `mise_sd.difusion` y de la parte de
// `mise_sd.actores` que usan los simuladores de la semana 3. Las pruebas de
// `codigo/tests/test_simuladores_guias.py` comparan lo determinista con
// Python valor a valor y lo estocástico por invariantes y por promedios de
// conjunto. Los grafos son los de `redes.js`.

import {azar, compararTexto, grado, intermediacion} from "./redes.js";
import {grafo as _grafoDesdeAristas, wattsStrogatz as _wattsStrogatz} from "./redes.js";

const _estados = (g, semillas) => {
  const s = new Set(semillas);
  return Object.fromEntries(g.nodos.map((n) => [n, s.has(n) ? 1 : 0]));
};
const _fraccionVecinos = (g, estado, n) => {
  const vs = g.vecinos.get(n);
  return vs.length ? vs.reduce((a, v) => a + (estado[v] === 1 ? 1 : 0), 0) / vs.length : 0;
};
/** Fracción de nodos en cada estado a lo largo de la historia. */
export const fracciones = (historia, valor) => historia.map((e) => Object.values(e).filter((x) => x === valor).length / Object.keys(e).length);

// ----------------------------------------------------------------------
// Dinámicas deterministas
// ----------------------------------------------------------------------

/** Regla de mayoría sincrónica con estados 0 y 1; en empate se conserva el estado. */
export function reglaMayoria(g, estadosIniciales, pasos) {
  let estado = {...estadosIniciales};
  const historia = [estado];
  for (let paso = 0; paso < pasos; paso++) {
    const nuevo = {...estado};
    for (const n of g.nodos) {
      const vs = g.vecinos.get(n), unos = vs.reduce((a, v) => a + estado[v], 0), ceros = vs.length - unos;
      if (unos > ceros) nuevo[n] = 1; else if (ceros > unos) nuevo[n] = 0;
    }
    estado = nuevo; historia.push(estado);
  }
  return historia;
}

/** Cascada de umbral fraccional de Watts (determinista y sincrónica). */
export function cascadaUmbral(g, umbral, semillas, {pasosMax = 1000} = {}) {
  const u = (n) => (typeof umbral === "number" ? umbral : umbral[n]);
  let estado = _estados(g, semillas);
  const historia = [estado];
  for (let paso = 0; paso < pasosMax; paso++) {
    const nuevos = g.nodos.filter((n) => estado[n] === 0 && g.vecinos.get(n).length > 0 && _fraccionVecinos(g, estado, n) >= u(n) - 1e-12);
    if (!nuevos.length) break;
    estado = {...estado};
    for (const n of nuevos) estado[n] = 1;
    historia.push(estado);
  }
  return historia;
}

/** Umbrales de Granovetter en población totalmente conectada: serie de activos por ronda. */
export function granovetter(umbrales, {enFraccion = false, activosIniciales = 0} = {}) {
  const n = umbrales.length;
  const valores = umbrales.map((x) => (enFraccion ? x * n : x)).sort((a, b) => a - b);
  let activos = activosIniciales;
  const serie = [activos];
  for (;;) {
    const siguientes = Math.max(valores.filter((v) => v <= activos + 1e-9).length, activos);
    if (siguientes === activos) break;
    activos = siguientes; serie.push(activos);
  }
  return serie;
}

/** Momentos del grado y umbrales de campo medio (SIS y SIR). */
export function umbralEpidemico(g) {
  const k = g.nodos.map((n) => grado(g, n));
  const k1 = k.reduce((a, x) => a + x, 0) / k.length, k2 = k.reduce((a, x) => a + x * x, 0) / k.length;
  return {k_medio: k1, k2_medio: k2, lambda_sis: k1 / k2, t_sir: k2 > k1 ? k1 / (k2 - k1) : Infinity};
}

/** Siembra de k nodos: "grado", "intermediacion", "aleatoria" o "grupo" (mismas reglas que Python). */
export function estrategiaSiembra(g, k, criterio = "grado", {semilla = 1} = {}) {
  const orden = Object.fromEntries(g.nodos.map((n, i) => [n, i]));
  if (criterio === "grado") return [...g.nodos].sort((a, b) => grado(g, b) - grado(g, a) || orden[a] - orden[b]).slice(0, k);
  if (criterio === "intermediacion") {
    const b = intermediacion(g);
    return [...g.nodos].sort((x, y) => b[y] - b[x] || orden[x] - orden[y]).slice(0, k);
  }
  if (criterio === "aleatoria") {
    const u = azar(semilla), resto = [...g.nodos], salida = [];
    while (salida.length < k) salida.push(resto.splice(Math.floor(u() * resto.length), 1)[0]);
    return salida;
  }
  if (criterio === "grupo") {
    const tri = Object.fromEntries(g.nodos.map((n) => {
      const vs = g.vecinos.get(n); let t = 0;
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) if (g.vecinos.get(vs[i]).includes(vs[j])) t++;
      return [n, t];
    }));
    const menor = (lista, clave) => lista.reduce((m, x) => { const a = clave(x), b = clave(m); for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return x; if (a[i] > b[i]) return m; } return m; });
    const grupo = [menor(g.nodos, (n) => [-tri[n], -grado(g, n), orden[n]])];
    const dentro = new Set(grupo);
    while (grupo.length < k) {
      const vecinosGrupo = new Set(grupo.flatMap((x) => g.vecinos.get(x)));
      let frontera = [...vecinosGrupo].filter((n) => !dentro.has(n));
      if (!frontera.length) frontera = g.nodos.filter((n) => !dentro.has(n));
      const siguiente = menor(frontera, (n) => [-g.vecinos.get(n).filter((v) => dentro.has(v)).length,
        -g.vecinos.get(n).filter((v) => vecinosGrupo.has(v)).length, -tri[n], orden[n]]);
      grupo.push(siguiente); dentro.add(siguiente);
    }
    return grupo;
  }
  throw new Error("criterio debe ser 'grado', 'intermediacion', 'aleatoria' o 'grupo'.");
}

// ----------------------------------------------------------------------
// Dinámicas estocásticas (generador con semilla de redes.js)
// ----------------------------------------------------------------------

/** Contagio SI, SIS o SIR discreto: contagio 1-(1-β)^m y salida γ, sincrónico. */
export function contagio(g, beta, gamma, semillas, pasos, {modelo = "SIR", semilla = 1} = {}) {
  const u = azar(semilla);
  let estado = _estados(g, semillas);
  const historia = [estado];
  for (let paso = 0; paso < pasos; paso++) {
    const nuevo = {...estado};
    for (const n of g.nodos) {
      const expuestos = g.vecinos.get(n).reduce((a, v) => a + (estado[v] === 1 ? 1 : 0), 0);
      const tiroContagio = u(), tiroSalida = u();
      if (estado[n] === 0 && tiroContagio < 1 - Math.pow(1 - beta, expuestos)) nuevo[n] = 1;
      if (estado[n] === 1 && modelo !== "SI" && tiroSalida < gamma) nuevo[n] = modelo === "SIS" ? 0 : 2;
    }
    estado = nuevo; historia.push(estado);
  }
  return historia;
}

/** Modelo del votante asincrónico; un barrido = N microactualizaciones. */
export function modeloVotante(g, {fraccionInicial = 0.5, estadosIniciales = null, barridos = 100, detenerEnConsenso = true, semilla = 1} = {}) {
  const u = azar(semilla), n = g.nodos.length;
  const estado = estadosIniciales ? {...estadosIniciales} : Object.fromEntries(g.nodos.map((x) => [x, u() < fraccionInicial ? 1 : 0]));
  let unos = Object.values(estado).reduce((a, b) => a + b, 0);
  const historia = [{...estado}];
  let consenso = unos === 0 || unos === n ? 0 : null;
  for (let barrido = 1; barrido <= barridos; barrido++) {
    if (consenso !== null && detenerEnConsenso) break;
    for (let i = 0; i < n; i++) {
      const nodo = g.nodos[Math.floor(u() * n)], vs = g.vecinos.get(nodo), tiro = u();
      if (!vs.length) continue;
      const nuevo = estado[vs[Math.floor(tiro * vs.length)]];
      unos += nuevo - estado[nodo]; estado[nodo] = nuevo;
    }
    historia.push({...estado});
    if (consenso === null && (unos === 0 || unos === n)) consenso = barrido;
  }
  return {historia, barridoConsenso: consenso};
}

/** Regla de Bass nodo a nodo: adopta con probabilidad p + q·(fracción de vecinos adoptantes). */
export function bassEnRed(g, p, q, pasos, {semillas = [], semilla = 1} = {}) {
  const u = azar(semilla);
  let estado = _estados(g, semillas);
  const historia = [estado];
  for (let paso = 0; paso < pasos; paso++) {
    const nuevo = {...estado};
    for (const n of g.nodos) {
      const tiro = u();
      if (estado[n] === 0 && tiro < Math.min(p + q * _fraccionVecinos(g, estado, n), 1)) nuevo[n] = 1;
    }
    estado = nuevo; historia.push(estado);
  }
  return historia;
}

/** Cascada de umbral con adopción espontánea de probabilidad p en cada paso. */
export function umbralConInnovadores(g, umbral, p, pasos, {semillas = [], semilla = 1} = {}) {
  const u = azar(semilla), um = (n) => (typeof umbral === "number" ? umbral : umbral[n]);
  let estado = _estados(g, semillas);
  const historia = [estado];
  for (let paso = 0; paso < pasos; paso++) {
    const nuevo = {...estado};
    for (const n of g.nodos) {
      const tiro = u();
      const porVecinos = g.vecinos.get(n).length > 0 && _fraccionVecinos(g, estado, n) >= um(n) - 1e-12;
      if (estado[n] === 0 && (porVecinos || tiro < p)) nuevo[n] = 1;
    }
    estado = nuevo; historia.push(estado);
  }
  return historia;
}

/** Regla de Bass en el grafo completo de n nodos (0…n−1), sin construir sus n(n−1)/2 aristas.
 *  Usa los mismos tiros que `bassEnRed` sobre `grafo` completo: cada no adoptante ve la
 *  fracción A/(n−1) de adoptantes entre los demás. Devuelve la misma historia de estados. */
export function bassEnRedCompleta(n, p, q, pasos, {semillas = [], semilla = 1} = {}) {
  const u = azar(semilla), nodos = [...Array(n).keys()];
  const s = new Set(semillas);
  let estado = Object.fromEntries(nodos.map((i) => [i, s.has(i) ? 1 : 0]));
  const historia = [estado];
  for (let paso = 0; paso < pasos; paso++) {
    const adoptantes = nodos.reduce((a, i) => a + estado[i], 0);
    const prob = Math.min(p + q * (n > 1 ? adoptantes / (n - 1) : 0), 1);
    const nuevo = {...estado};
    for (const i of nodos) { const tiro = u(); if (estado[i] === 0 && tiro < prob) nuevo[i] = 1; }
    estado = nuevo; historia.push(estado);
  }
  return historia;
}

// ----------------------------------------------------------------------
// Bass agregado
// ----------------------------------------------------------------------

/** Solución analítica de Bass: acumulado y nuevos por unidad de tiempo en cada t. */
export function bass(p, q, m, tiempos) {
  return tiempos.map((t) => {
    const e = Math.exp(-(p + q) * t), d = 1 + (q / p) * e;
    return {t, acumulado: m * (1 - e) / d, nuevos: m * ((p + q) ** 2 / p) * e / d ** 2};
  });
}

/** Tiempo del pico de adopciones nuevas: ln(q/p)/(p+q), o 0 si q <= p. */
export const tiempoPicoBass = (p, q) => (q <= p ? 0 : Math.log(q / p) / (p + q));

/** Bass en tiempo discreto: nuevos_t = (p + q N/m)(m − N). */
export function bassDiscreto(p, q, m, periodos, {acumuladoInicial = 0} = {}) {
  let N = acumuladoInicial;
  const filas = [{periodo: 0, nuevos: 0, acumulado: N}];
  for (let t = 1; t <= periodos; t++) { const nuevos = (p + q * N / m) * (m - N); N += nuevos; filas.push({periodo: t, nuevos, acumulado: N}); }
  return filas;
}

/** Ajuste de Bass por mínimos cuadrados (Levenberg–Marquardt con cotas).
 *  Mismas cotas que `ajustar_bass`: p en [1e-6, 1], q en [0, 5], m en [0,5·último, 100·último]
 *  o `mMaximo`; con `mFijo` solo se ajustan p y q. Devuelve p, q, m, errores y RMSE. */
export function ajustarBass(t, acumulado, {pInicial = 0.01, qInicial = 0.3, mInicial = null, mMaximo = null, mFijo = null} = {}) {
  const ultimo = Math.max(...acumulado);
  const tope = mMaximo ?? 100 * ultimo;
  const libres = mFijo === null ? 3 : 2;
  const inf = [1e-6, 0, 0.5 * ultimo], sup = [1, 5, tope];
  let x = [pInicial, qInicial, Math.min(Math.max(mInicial ?? 2 * ultimo, ultimo * 1.0001), tope * 0.999)].slice(0, libres);
  const curva = (v) => bass(v[0], v[1], mFijo ?? v[2], t).map((f) => f.acumulado);
  const residuos = (v) => curva(v).map((c, i) => c - acumulado[i]);
  const sse = (v) => residuos(v).reduce((a, r) => a + r * r, 0);
  const acotar = (v) => v.map((xi, i) => Math.min(Math.max(xi, inf[i]), sup[i]));
  const jacobiano = (v) => {
    const base = curva(v);
    return v.map((xi, j) => { const h = Math.max(Math.abs(xi) * 1e-6, 1e-10), w = [...v]; w[j] += h; return curva(w).map((c, i) => (c - base[i]) / h); });
  };
  const resolver = (A, b) => { // eliminación gaussiana con pivoteo
    const n = b.length, M = A.map((fila, i) => [...fila, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const s = Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let a = M[r][n]; for (let k = r + 1; k < n; k++) a -= M[r][k] * s[k]; s[r] = a / M[r][r]; }
    return s;
  };
  let lambda = 1e-3, actual = sse(x);
  for (let iter = 0; iter < 2000; iter++) {
    const J = jacobiano(x), r = residuos(x);
    const JTJ = x.map((_, a) => x.map((__, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
    const JTr = x.map((_, a) => J[a].reduce((s, v, i) => s + v * r[i], 0));
    let mejoro = false;
    for (let intento = 0; intento < 20; intento++) {
      const A = JTJ.map((fila, i) => fila.map((v, j) => v + (i === j ? lambda * (JTJ[i][i] || 1) : 0)));
      const paso = resolver(A, JTr.map((v) => -v));
      const nuevo = acotar(x.map((xi, i) => xi + paso[i]));
      const valor = sse(nuevo);
      if (valor < actual) { const cambio = actual - valor; x = nuevo; actual = valor; lambda = Math.max(lambda / 10, 1e-12); mejoro = cambio > 1e-14 * Math.max(1, actual); break; }
      lambda *= 10;
    }
    if (!mejoro) break;
  }
  const J = jacobiano(x), n = t.length;
  const JTJ = x.map((_, a) => x.map((__, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
  const s2 = actual / Math.max(n - libres, 1);
  const inversa = x.map((_, j) => resolver(JTJ, x.map((__, i) => (i === j ? 1 : 0))));
  const errores = x.map((_, i) => Math.sqrt(Math.max(inversa[i][i] * s2, 0)));
  return {p: x[0], q: x[1], m: mFijo ?? x[2], errores: {p: errores[0], q: errores[1], m: mFijo === null ? errores[2] : 0},
    correlacion_p_m: mFijo === null ? inversa[0][2] / Math.sqrt(inversa[0][0] * inversa[2][2]) : 0,
    rmse: Math.sqrt(actual / n)};
}

// ----------------------------------------------------------------------
// Redes de actores y mercado (réplica de mise_sd.actores)
// Red ponderada: {nodos: [{id, lado?}], aristas: [{a, b, peso?, signo?}]}
// ----------------------------------------------------------------------

const _peso = (e, usarPeso) => (usarPeso ? e.peso ?? 1 : 1);

/** Modularidad Q = Σ_c [L_c/m − (d_c/2m)²] con pesos opcionales (solo aristas positivas). */
export function modularidad(red, particion, {usarPeso = false} = {}) {
  const aristas = red.aristas.filter((e) => (e.signo ?? 1) > 0);
  const grupo = new Map(); particion.forEach((g, i) => g.forEach((n) => grupo.set(n, i)));
  const m = aristas.reduce((a, e) => a + _peso(e, usarPeso), 0);
  const L = Array(particion.length).fill(0), d = Array(particion.length).fill(0);
  for (const e of aristas) {
    const w = _peso(e, usarPeso), ga = grupo.get(e.a), gb = grupo.get(e.b);
    d[ga] += w; d[gb] += w;
    if (ga === gb) L[ga] += w;
  }
  return L.reduce((q, l, c) => q + l / m - (d[c] / (2 * m)) ** 2, 0);
}

/** Comunidades por modularidad codiciosa (Clauset, Newman y Moore): une el par con mayor ΔQ. */
export function comunidadesCodiciosas(red, {usarPeso = false} = {}) {
  const aristas = red.aristas.filter((e) => (e.signo ?? 1) > 0);
  const ids = red.nodos.map((n) => n.id ?? n);
  let grupos = ids.map((n) => [n]);
  const indice = () => { const mapa = new Map(); grupos.forEach((g, i) => g.forEach((n) => mapa.set(n, i))); return mapa; };
  const m = aristas.reduce((a, e) => a + _peso(e, usarPeso), 0);
  for (;;) {
    const donde = indice(), e = new Map(), a = Array(grupos.length).fill(0);
    for (const x of aristas) {
      const w = _peso(x, usarPeso) / (2 * m), i = donde.get(x.a), j = donde.get(x.b);
      a[i] += w; a[j] += w;
      if (i !== j) { const k = i < j ? `${i}|${j}` : `${j}|${i}`; e.set(k, (e.get(k) ?? 0) + w); }
    }
    let mejor = null, delta = 0;
    for (const [k, eij] of e) {
      const [i, j] = k.split("|").map(Number), dq = 2 * (eij - a[i] * a[j]);
      if (dq > delta + 1e-15 || (mejor && Math.abs(dq - delta) <= 1e-15 && k < mejor)) { delta = dq; mejor = k; }
    }
    if (!mejor || delta <= 1e-15) break;
    const [i, j] = mejor.split("|").map(Number);
    grupos[i] = [...grupos[i], ...grupos[j]];
    grupos = grupos.filter((_, k) => k !== j);
  }
  const orden = Object.fromEntries(ids.map((n, i) => [n, i]));
  return grupos.sort((x, y) => y.length - x.length || Math.min(...x.map((n) => orden[n])) - Math.min(...y.map((n) => orden[n])));
}

/** Volumen de un nodo: suma de los pesos de sus aristas. */
const _volumen = (red, id) => red.aristas.reduce((a, e) => a + (e.a === id || e.b === id ? e.peso ?? 1 : 0), 0);

/** Participación de cada nodo de un lado en el volumen de ese lado. */
export function participaciones(red, lado) {
  const nodos = red.nodos.filter((n) => n.lado === lado).map((n) => n.id);
  const vol = Object.fromEntries(nodos.map((n) => [n, _volumen(red, n)]));
  const total = Object.values(vol).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(vol).map(([k, v]) => [k, v / total]).sort((x, y) => y[1] - x[1]));
}

/** Índice de Herfindahl–Hirschman en porcentajes (0 a 10 000). */
export function hhi(valores) {
  const v = Array.isArray(valores) ? valores : Object.values(valores);
  const total = v.reduce((a, b) => a + b, 0);
  return v.reduce((a, x) => a + (100 * x / total) ** 2, 0);
}

/** Proyección de una red bipartita sobre un lado: "conteo" o "minimo" de volumen compartido. */
export function proyectar(red, lado, {metodo = "conteo"} = {}) {
  const nodos = red.nodos.filter((n) => n.lado === lado).map((n) => n.id), conjunto = new Set(nodos);
  const vecinos = new Map(red.nodos.map((n) => [n.id, new Map()]));
  for (const e of red.aristas) { vecinos.get(e.a).set(e.b, e.peso ?? 1); vecinos.get(e.b).set(e.a, e.peso ?? 1); }
  const salida = [];
  for (let i = 0; i < nodos.length; i++) for (let j = i + 1; j < nodos.length; j++) {
    const u = nodos[i], v = nodos[j];
    const comunes = [...vecinos.get(u).keys()].filter((w) => vecinos.get(v).has(w) && !conjunto.has(w)).sort(compararTexto);
    if (!comunes.length) continue;
    const peso = metodo === "conteo" ? comunes.length : comunes.reduce((a, w) => a + Math.min(vecinos.get(u).get(w), vecinos.get(v).get(w)), 0);
    salida.push({a: u, b: v, peso, compartidos: comunes});
  }
  return {nodos: nodos.map((id) => ({id, lado})), aristas: salida};
}

/** Salida de un nodo: volumen perdido, HHI por lado antes y después y exposición de sus vecinos. */
export function salidaDeNodo(red, nodo) {
  const total = red.aristas.reduce((a, e) => a + (e.peso ?? 1), 0);
  const perdido = _volumen(red, nodo);
  const exposicion = {};
  for (const e of red.aristas) {
    if (e.a !== nodo && e.b !== nodo) continue;
    const v = e.a === nodo ? e.b : e.a;
    exposicion[v] = (e.peso ?? 1) / _volumen(red, v);
  }
  const despues = {nodos: red.nodos.filter((n) => n.id !== nodo), aristas: red.aristas.filter((e) => e.a !== nodo && e.b !== nodo)};
  const lados = [...new Set(red.nodos.map((n) => n.lado).filter(Boolean))].sort(compararTexto);
  const hhiLado = (r) => Object.fromEntries(lados.map((l) => {
    const vol = r.nodos.filter((n) => n.lado === l).map((n) => _volumen(r, n.id)).filter((v) => v > 0);
    return [l, vol.length ? hhi(vol) : NaN];
  }));
  return {nodo, volumen_perdido: perdido, fraccion_volumen_perdido: perdido / total,
    hhi_antes: hhiLado(red), hhi_despues: hhiLado(despues),
    exposicion: Object.fromEntries(Object.entries(exposicion).sort((x, y) => y[1] - x[1]))};
}

// ----------------------------------------------------------------------
// Semillas para conjuntos de corridas
// ----------------------------------------------------------------------

/** Semilla de la corrida c de un conjunto. El generador `azar` es congruencial:
 *  con semillas consecutivas (1, 2, 3...) las primeras extracciones de cada corrida
 *  quedan casi iguales y en línea recta, y un conjunto de corridas cortas sale sesgado
 *  (el votante en una estrella de cinco nodos da 0,62 en lugar de 0,50). Esta función
 *  mezcla c con el finalizador de MurmurHash3, que no es lineal. */
export function semillaCorrida(c, base = 0) {
  let h = (c + base + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}

// ----------------------------------------------------------------------
// Contagio complejo e intervención (guía S3, conceptos 4 y 5).
// Réplica exacta en mise_sd.difusion: mismas redes (generador azar) y
// mismas cascadas; la prueba compara valor a valor.
// ----------------------------------------------------------------------

/** Cascada de umbral por frentes: mismo conjunto final y mismos pasos que `cascadaUmbral`,
 *  pero con arreglos, para repetirla cientos de veces en el navegador. */
export function cascadaRapida(g, umbral, semillas) {
  const n = g.nodos.length, indice = new Map(g.nodos.map((x, i) => [x, i]));
  const vecinos = g.nodos.map((x) => g.vecinos.get(x).map((v) => indice.get(v)));
  const phi = typeof umbral === "number" ? null : g.nodos.map((x) => umbral[x]);
  const activo = new Uint8Array(n), cuenta = new Int32Array(n);
  let frente = [...new Set(semillas.map((s) => indice.get(s)))];
  for (const i of frente) activo[i] = 1;
  let total = frente.length, pasos = 0;
  // Un umbral nulo se cumple con cero vecinos activos: esos nodos entran en el primer paso
  const espontaneos = g.nodos.map((_, i) => i).filter((i) => !activo[i] && vecinos[i].length && (phi ? phi[i] : umbral) <= 1e-12);
  let primera = true;
  while (frente.length || primera) {
    for (const i of frente) for (const v of vecinos[i]) cuenta[v] += 1;
    const candidatos = new Set(primera ? espontaneos : []);
    primera = false;
    for (const i of frente) for (const v of vecinos[i]) if (!activo[v]) candidatos.add(v);
    const nuevos = [...candidatos].filter((v) => cuenta[v] / vecinos[v].length >= (phi ? phi[v] : umbral) - 1e-12);
    if (!nuevos.length) break;
    for (const v of nuevos) activo[v] = 1;
    total += nuevos.length; pasos += 1; frente = nuevos;
  }
  return {activo, total, pasos, fraccion: n ? total / n : 0};
}

/** Siembra una cascada desde un nodo al azar, `corridas` veces: tamaños, frecuencia de
 *  cascadas globales (más de `umbralGlobal` de la red) y tamaño medio de las globales. */
export function frecuenciaCascadas(g, umbral, {corridas = 200, semilla = 1, umbralGlobal = 0.10} = {}) {
  const u = azar(semilla), n = g.nodos.length, tamanos = [], semillas = [];
  for (let c = 0; c < corridas; c++) {
    const s = g.nodos[Math.floor(u() * n)];
    semillas.push(s); tamanos.push(cascadaRapida(g, umbral, [s]).fraccion);
  }
  const globales = tamanos.filter((x) => x > umbralGlobal);
  return {tamanos, semillas, frecuencia: globales.length / corridas,
    tamanoGlobal: globales.length ? globales.reduce((a, b) => a + b, 0) / globales.length : NaN};
}

/** Nodos vulnerables (una vecina activa basta: 1/k >= φ) y su mayor grupo conexo. */
export function vulnerables(g, umbral) {
  const es = new Set(g.nodos.filter((x) => { const k = g.vecinos.get(x).length; return k > 0 && 1 / k >= umbral - 1e-12; }));
  const visto = new Set(); let mayor = 0;
  for (const x of es) {
    if (visto.has(x)) continue;
    let tam = 0; const pila = [x]; visto.add(x);
    while (pila.length) { const y = pila.pop(); tam++; for (const v of g.vecinos.get(y)) if (es.has(v) && !visto.has(v)) { visto.add(v); pila.push(v); } }
    mayor = Math.max(mayor, tam);
  }
  return {fraccion: g.nodos.length ? es.size / g.nodos.length : 0, mayorGrupo: mayor};
}

/** Red de Erdős y Rényi G(n, z/(n−1)) con el generador de redes.js (misma réplica en Python). */
export function redErdosRenyiWeb(n, z, semilla = 1) {
  const u = azar(semilla), p = z / (n - 1), aristas = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (u() < p) aristas.push([i, j]);
  return _grafoDesdeAristas(aristas, [...Array(n).keys()]);
}

/** Barabási y Albert con m >= 2 enlaces por nodo nuevo (misma regla que redes.barabasiAlbert). */
export function redBarabasiAlbertWeb(n, m, semilla = 1) {
  if (m < 2) throw new Error("m debe ser al menos 2.");
  const u = azar(semilla), aristas = [], repetidos = [];
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) { aristas.push([i, j]); repetidos.push(i, j); }
  for (let nuevo = m; nuevo < n; nuevo++) {
    const elegidos = new Set();
    while (elegidos.size < m) elegidos.add(repetidos[Math.floor(u() * repetidos.length)]);
    for (const objetivo of elegidos) { aristas.push([objetivo, nuevo]); repetidos.push(objetivo, nuevo); }
  }
  return _grafoDesdeAristas(aristas, [...Array(n).keys()]);
}

/** Ciudad sintética de la guía S3 (concepto 5): 16 barrios de 60 hogares. */
export const CIUDAD_SINTETICA = {
  barrios: 16, hogaresPorBarrio: 60,
  estratos: [...Array(4).fill("alto"), ...Array(6).fill("medio"), ...Array(6).fill("bajo")],
  umbralMedio: {alto: 0.20, medio: 0.30, bajo: 0.40}, desviacion: 0.08,
  vecinosLocales: 6, recableo: 0.05, puentes: 0.10, innovadores: 0.02,
  presupuesto: 48, barriosFocalizados: [10, 11, 12, 13], reduccionFocalizada: 0.20,
};

/** Normal estándar aproximada por la suma de 12 uniformes menos 6 (solo aritmética:
 *  así Python la reproduce bit a bit). */
const _normalAproximada = (u) => { let s = 0; for (let i = 0; i < 12; i++) s += u(); return s - 6; };

/** Construye la ciudad: red (Watts-Strogatz por barrio más vínculos entre barrios),
 *  umbral de cada hogar según su estrato, estrato por hogar e innovadores. */
export function ciudadSintetica({semilla = 1, desplazamiento = 0} = {}) {
  const P = CIUDAD_SINTETICA, H = P.hogaresPorBarrio, N = P.barrios * H, u = azar(semilla);
  const aristas = [], umbrales = {}, estrato = {};
  for (let b = 0; b < P.barrios; b++) {
    const local = _wattsStrogatz(H, P.vecinosLocales, P.recableo, 1 + Math.floor(u() * 2147483646));
    for (const [a, vs] of local.vecinos) for (const c of vs) if (a < c) aristas.push([b * H + a, b * H + c]);
    const media = P.umbralMedio[P.estratos[b]] + desplazamiento;
    for (let h = 0; h < H; h++) {
      estrato[b * H + h] = P.estratos[b];
      umbrales[b * H + h] = Math.min(Math.max(media + P.desviacion * _normalAproximada(u), 0.02), 0.95);
    }
  }
  for (let n = 0; n < N; n++) {
    if (u() >= P.puentes) continue;
    let otro = Math.floor(u() * N);
    while (Math.floor(otro / H) === Math.floor(n / H)) otro = Math.floor(u() * N);
    aristas.push([n, otro]);
  }
  const resto = [...Array(N).keys()], innovadores = [];
  const cuantos = Math.floor(P.innovadores * N);
  while (innovadores.length < cuantos) innovadores.push(resto.splice(Math.floor(u() * resto.length), 1)[0]);
  return {g: _grafoDesdeAristas(aristas, [...Array(N).keys()]), umbrales, estrato, innovadores};
}

/** Aplica una política del mismo presupuesto y corre la cascada.
 *  Políticas: "sin intervención", "subsidio uniforme" (todos los umbrales bajan `reduccion`),
 *  "subsidio focalizado" (4 barrios de estrato bajo bajan 0,20), "vitrinas" (grupos de
 *  `tamanoGrupo` hogares vecinos, un grupo por barrio en ciclo, empezando por los de estrato bajo). */
export function politicaCiudad(ciudad, politica, {reduccion = 0.05, tamanoGrupo = 3, semilla = 1} = {}) {
  const P = CIUDAD_SINTETICA, H = P.hogaresPorBarrio, g = ciudad.g;
  let umbrales = ciudad.umbrales;
  const semillas = [...ciudad.innovadores];
  if (politica === "subsidio uniforme") {
    umbrales = Object.fromEntries(g.nodos.map((n) => [n, Math.max(ciudad.umbrales[n] - reduccion, 0)]));
  } else if (politica === "subsidio focalizado") {
    umbrales = Object.fromEntries(g.nodos.map((n) => [n, P.barriosFocalizados.includes(Math.floor(n / H))
      ? Math.max(ciudad.umbrales[n] - P.reduccionFocalizada, 0) : ciudad.umbrales[n]]));
  } else if (politica === "vitrinas") {
    const u = azar(semilla), elegidas = new Set(semillas);
    for (let k = 0; k < Math.floor(P.presupuesto / tamanoGrupo); k++) {
      const barrio = P.barrios - 1 - (k % P.barrios);
      const libres = [...Array(H).keys()].map((h) => barrio * H + h).filter((n) => !elegidas.has(n));
      let grupo;
      if (tamanoGrupo === 1) grupo = [libres[Math.floor(u() * libres.length)]];
      else {
        const dentro = new Set(libres), aristas = [];
        for (const a of libres) for (const b of g.vecinos.get(a)) if (a < b && dentro.has(b)) aristas.push([a, b]);
        grupo = estrategiaSiembra(_grafoDesdeAristas(aristas, libres), tamanoGrupo, "grupo");
      }
      for (const n of grupo) { elegidas.add(n); semillas.push(n); }
    }
  } else if (politica !== "sin intervención") throw new Error(`Política desconocida: ${politica}`);
  const r = cascadaRapida(g, umbrales, semillas);
  const porEstrato = {};
  for (const e of Object.keys(P.umbralMedio)) {
    const nodos = g.nodos.filter((n) => ciudad.estrato[n] === e);
    porEstrato[e] = nodos.filter((n) => r.activo[n]).length / nodos.length;
  }
  return {total: r.fraccion, porEstrato, semillas, pasos: r.pasos};
}

/** Media y desviación (poblacional) de una política en `realizaciones` ciudades (semillas 1…R). */
export function resumenPolitica(politica, {realizaciones = 30, desplazamiento = 0, ...opciones} = {}) {
  const corridas = [...Array(realizaciones).keys()].map((s) => politicaCiudad(ciudadSintetica({semilla: s + 1, desplazamiento}), politica, opciones));
  const estad = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return {media: m, desviacion: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)}; };
  return {total: estad(corridas.map((c) => c.total)),
    porEstrato: Object.fromEntries(Object.keys(CIUDAD_SINTETICA.umbralMedio).map((e) => [e, estad(corridas.map((c) => c.porEstrato[e]))])),
    corridas};
}

/** Red de coparticipación (réplica de `actores.red_coparticipacion`): dos actores se enlazan
 *  con peso igual al número de documentos que comparten. `documentos` es {id: [firmantes]}.
 *  Devuelve la red ponderada {nodos: [{id, documentos}], aristas: [{a, b, peso}]}. */
export function redCoparticipacion(documentos) {
  const nodos = new Map(), aristas = new Map();
  for (const firmantes of Object.values(documentos)) {
    const actores = [...new Set(firmantes)].sort(compararTexto);
    for (const x of actores) nodos.set(x, (nodos.get(x) ?? 0) + 1);
    for (let i = 0; i < actores.length; i++) for (let j = i + 1; j < actores.length; j++) {
      const clave = `${actores[i]}\u0000${actores[j]}`;
      if (aristas.has(clave)) aristas.get(clave).peso += 1;
      else aristas.set(clave, {a: actores[i], b: actores[j], peso: 1});
    }
  }
  return {nodos: [...nodos].map(([id, documentos]) => ({id, documentos})), aristas: [...aristas.values()]};
}
