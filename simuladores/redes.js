// redes.js — réplica en JavaScript de `mise_sd.redes` para los simuladores
// de las guías (semanas 2 y 3). Mismos nombres y mismas normalizaciones
// que NetworkX; las pruebas de `codigo/tests/test_simuladores_guias.py`
// comparan cada función con NetworkX sobre las mismas aristas.
//
// Un grafo se representa como {nodos: [id...], vecinos: Map(id -> [id...])}
// y se construye con `grafo(aristas, nodosSueltos)`. Todas las funciones
// tratan el grafo como no dirigido y sin pesos, salvo donde se indique.

/** Orden por texto, igual que `sorted(..., key=str)` de Python. */
export const compararTexto = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** Construye un grafo no dirigido a partir de una lista de aristas. */
export function grafo(aristas, nodosSueltos = []) {
  const vecinos = new Map();
  const agregar = (n) => { if (!vecinos.has(n)) vecinos.set(n, []); };
  for (const n of nodosSueltos) agregar(n);
  for (const [a, b] of aristas) {
    agregar(a); agregar(b);
    if (a === b) continue;
    if (!vecinos.get(a).includes(b)) vecinos.get(a).push(b);
    if (!vecinos.get(b).includes(a)) vecinos.get(b).push(a);
  }
  return {nodos: [...vecinos.keys()], vecinos};
}

/** Copia del grafo sin los nodos indicados. */
export function sinNodos(g, retirados) {
  const fuera = new Set(retirados);
  const aristas = [];
  for (const [a, vs] of g.vecinos) for (const b of vs) {
    if (!fuera.has(a) && !fuera.has(b) && String(a) < String(b)) aristas.push([a, b]);
  }
  return grafo(aristas, g.nodos.filter((n) => !fuera.has(n)));
}

export const numeroDeNodos = (g) => g.nodos.length;
export const numeroDeAristas = (g) => [...g.vecinos.values()].reduce((a, v) => a + v.length, 0) / 2;
export const grado = (g, n) => g.vecinos.get(n).length;
/** Grados por nodo, como objeto {nodo: grado}. */
export const grados = (g) => Object.fromEntries(g.nodos.map((n) => [n, grado(g, n)]));
export const gradoMedio = (g) => (g.nodos.length ? 2 * numeroDeAristas(g) / g.nodos.length : 0);
/** Densidad 2m/(n(n-1)). */
export function densidad(g) {
  const n = g.nodos.length;
  return n > 1 ? 2 * numeroDeAristas(g) / (n * (n - 1)) : 0;
}

/** Distribución complementaria acumulada del grado: {k, P} con P = Pr(K >= k). */
export function ccdfGrado(g) {
  const gs = g.nodos.map((n) => grado(g, n));
  const valores = [...new Set(gs)].sort((a, b) => a - b);
  return {k: valores, P: valores.map((k) => gs.filter((x) => x >= k).length / gs.length)};
}

/** Distancias en saltos desde un nodo (recorrido en anchura). */
export function distancias(g, origen) {
  const d = new Map([[origen, 0]]);
  const cola = [origen];
  for (let i = 0; i < cola.length; i++) {
    const actual = cola[i];
    for (const v of g.vecinos.get(actual)) if (!d.has(v)) { d.set(v, d.get(actual) + 1); cola.push(v); }
  }
  return d;
}

/** Componentes conexas, de mayor a menor tamaño. */
export function componentes(g) {
  const vistos = new Set(), salida = [];
  for (const n of g.nodos) {
    if (vistos.has(n)) continue;
    const c = [...distancias(g, n).keys()];
    c.forEach((x) => vistos.add(x));
    salida.push(c);
  }
  return salida.sort((a, b) => b.length - a.length);
}

export const componenteGigante = (g) => (g.nodos.length ? componentes(g)[0] : []);
/** Fracción de la componente gigante, medida contra `nOriginal` si se da. */
export const fraccionComponenteGigante = (g, nOriginal = null) => {
  const n = nOriginal ?? g.nodos.length;
  return n ? componenteGigante(g).length / n : 0;
};

/** Diámetro y longitud media de camino sobre la componente gigante. */
export function distanciasGigante(g) {
  const gigante = new Set(componenteGigante(g));
  if (gigante.size < 2) return {diametro: 0, longitudMedia: 0};
  const sub = sinNodos(g, g.nodos.filter((n) => !gigante.has(n)));
  let maxima = 0, suma = 0, pares = 0;
  for (const n of sub.nodos) for (const [, d] of distancias(sub, n)) { maxima = Math.max(maxima, d); suma += d; pares++; }
  return {diametro: maxima, longitudMedia: suma / (pares - sub.nodos.length)};
}

/** Coeficiente de agrupamiento local de un nodo. */
export function agrupamientoLocal(g, n) {
  const vs = g.vecinos.get(n);
  if (vs.length < 2) return 0;
  let enlaces = 0;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
    if (g.vecinos.get(vs[i]).includes(vs[j])) enlaces++;
  }
  return 2 * enlaces / (vs.length * (vs.length - 1));
}

export const agrupamientoMedio = (g) => (g.nodos.length ? g.nodos.reduce((a, n) => a + agrupamientoLocal(g, n), 0) / g.nodos.length : 0);

/** Intermediación de nodos y de aristas con el algoritmo de Brandes. */
export function brandes(g, {normalizada = true} = {}) {
  const nodos = g.nodos, n = nodos.length;
  const nodo = Object.fromEntries(nodos.map((x) => [x, 0]));
  const arista = new Map();
  const clave = (a, b) => (String(a) < String(b) ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const [a, vs] of g.vecinos) for (const b of vs) arista.set(clave(a, b), 0);
  for (const s of nodos) {
    const pila = [], predecesores = new Map(nodos.map((x) => [x, []]));
    const sigma = new Map(nodos.map((x) => [x, 0])), dist = new Map(nodos.map((x) => [x, -1]));
    sigma.set(s, 1); dist.set(s, 0);
    const cola = [s];
    for (let i = 0; i < cola.length; i++) {
      const v = cola[i]; pila.push(v);
      for (const w of g.vecinos.get(v)) {
        if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); cola.push(w); }
        if (dist.get(w) === dist.get(v) + 1) { sigma.set(w, sigma.get(w) + sigma.get(v)); predecesores.get(w).push(v); }
      }
    }
    const delta = new Map(nodos.map((x) => [x, 0]));
    while (pila.length) {
      const w = pila.pop();
      for (const v of predecesores.get(w)) {
        const c = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        delta.set(v, delta.get(v) + c);
        arista.set(clave(v, w), arista.get(clave(v, w)) + c);
      }
      if (w !== s) nodo[w] += delta.get(w);
    }
  }
  for (const k of Object.keys(nodo)) nodo[k] /= 2;
  for (const [k, v] of arista) arista.set(k, v / 2);
  if (normalizada && n > 2) {
    const escalaNodo = 2 / ((n - 1) * (n - 2)), escalaArista = 2 / (n * (n - 1));
    for (const k of Object.keys(nodo)) nodo[k] *= escalaNodo;
    for (const [k, v] of arista) arista.set(k, v * escalaArista);
  }
  return {nodo, arista};
}

/** Intermediación de nodos (normalizada como en NetworkX). */
export const intermediacion = (g, opciones) => brandes(g, opciones).nodo;
/** Intermediación de aristas, como objeto {"a|b": valor} con a < b. */
export function intermediacionAristas(g, opciones) {
  const salida = {};
  for (const [k, v] of brandes(g, opciones).arista) salida[k.split("\u0000").join("|")] = v;
  return salida;
}

/** Cercanía con la corrección de Wasserman y Faust. */
export function cercania(g) {
  const n = g.nodos.length, salida = {};
  for (const x of g.nodos) {
    const d = distancias(g, x), alcanzables = d.size - 1;
    const suma = [...d.values()].reduce((a, b) => a + b, 0);
    salida[x] = suma > 0 ? (alcanzables / suma) * (alcanzables / (n - 1)) : 0;
  }
  return salida;
}

/** Centralidad de vector propio por iteración de potencia sobre A + I (norma 2 = 1);
 *  sumar la identidad no cambia el vector propio y evita oscilar en redes casi bipartitas. */
export function vectorPropio(g, {iteraciones = 1000, tolerancia = 1e-10} = {}) {
  let x = Object.fromEntries(g.nodos.map((n) => [n, 1 / Math.sqrt(g.nodos.length)]));
  for (let paso = 0; paso < iteraciones; paso++) {
    const y = Object.fromEntries(g.nodos.map((n) => [n, x[n]]));
    for (const n of g.nodos) for (const v of g.vecinos.get(n)) y[n] += x[v];
    const norma = Math.sqrt(Object.values(y).reduce((a, b) => a + b * b, 0)) || 1;
    let cambio = 0;
    for (const n of g.nodos) { const nuevo = y[n] / norma; cambio += Math.abs(nuevo - x[n]); x[n] = nuevo; }
    if (cambio < tolerancia) break;
  }
  return x;
}

/** Tabla de centralidades por nodo, ordenada por intermediación. */
export function centralidades(g) {
  const n = g.nodos.length, b = intermediacion(g), c = cercania(g), v = vectorPropio(g);
  return g.nodos.map((x) => ({nodo: x, grado: grado(g, x), centralidad_grado: grado(g, x) / (n - 1),
    intermediacion: b[x], cercania: c[x], vector_propio: v[x]}))
    .sort((p, q) => q.intermediacion - p.intermediacion || q.grado - p.grado);
}

/** Puntos de articulación (nodos cuya salida desconecta la red). */
export function puntosArticulacion(g) {
  const visitado = new Set(), tin = new Map(), low = new Map(), salida = new Set();
  let tiempo = 0;
  const recorrer = (v, padre) => {
    visitado.add(v); tin.set(v, tiempo); low.set(v, tiempo); tiempo++;
    let hijos = 0;
    for (const w of g.vecinos.get(v)) {
      if (w === padre) continue;
      if (visitado.has(w)) { low.set(v, Math.min(low.get(v), tin.get(w))); continue; }
      recorrer(w, v); hijos++;
      low.set(v, Math.min(low.get(v), low.get(w)));
      if (padre !== null && low.get(w) >= tin.get(v)) salida.add(v);
    }
    if (padre === null && hijos > 1) salida.add(v);
  };
  for (const n of g.nodos) if (!visitado.has(n)) recorrer(n, null);
  return [...salida].sort(compararTexto);
}

/** Resumen de métricas globales (mismas claves que `resumen_topologico`). */
export function resumenTopologico(g) {
  const {diametro, longitudMedia} = distanciasGigante(g);
  const gs = g.nodos.map((n) => grado(g, n));
  return {nodos: g.nodos.length, aristas: numeroDeAristas(g), densidad: densidad(g),
    grado_medio: gradoMedio(g), grado_maximo: gs.length ? Math.max(...gs) : 0,
    nodos_grado_1: gs.filter((k) => k === 1).length, componentes: componentes(g).length,
    fraccion_gigante: fraccionComponenteGigante(g), diametro, longitud_media_camino: longitudMedia,
    agrupamiento_medio: agrupamientoMedio(g)};
}

// ----------------------------------------------------------------------
// Robustez, N-1 y cascadas
// ----------------------------------------------------------------------

/** Curva de robustez: fracción de la componente gigante al retirar nodos.
 *  `estrategia`: "aleatoria" (usa `orden`), "grado" o "intermediacion".
 *  Con `recalcular` el puntaje se recalcula tras cada retiro. Los empates
 *  se rompen por la posición del nodo en `g.nodos` (determinista). */
export function curvaRobustez(g, {estrategia = "aleatoria", recalcular = true, orden = null, fraccionMaxima = 1} = {}) {
  const n = g.nodos.length, pasos = Math.floor(fraccionMaxima * n);
  const posicion = Object.fromEntries(g.nodos.map((x, i) => [x, i]));
  const puntaje = (h) => (estrategia === "grado" ? grados(h) : intermediacion(h));
  let trabajo = g, secuencia = [], fijo = null;
  if (estrategia === "aleatoria") fijo = orden ?? [...g.nodos];
  else if (!recalcular) {
    const p = puntaje(g);
    fijo = [...g.nodos].sort((a, b) => p[b] - p[a] || posicion[a] - posicion[b]);
  }
  const filas = [{nodos_retirados: 0, fraccion_retirada: 0, fraccion_gigante: fraccionComponenteGigante(trabajo, n)}];
  for (let paso = 1; paso <= pasos; paso++) {
    let objetivo;
    if (fijo) objetivo = fijo[paso - 1];
    else {
      const p = puntaje(trabajo);
      objetivo = [...trabajo.nodos].sort((a, b) => p[b] - p[a] || posicion[a] - posicion[b])[0];
    }
    secuencia.push(objetivo);
    trabajo = sinNodos(trabajo, [objetivo]);
    filas.push({nodos_retirados: paso, fraccion_retirada: paso / n, fraccion_gigante: fraccionComponenteGigante(trabajo, n)});
  }
  return {filas, secuencia, area: filas.reduce((a, f) => a + f.fraccion_gigante, 0) / filas.length};
}

/** Verificación N-1 topológica: qué deja aislado la salida de cada nodo. */
export function analisisNmenos1(g) {
  const n = g.nodos.length, articulaciones = new Set(puntosArticulacion(g));
  return g.nodos.map((nodo) => {
    const trabajo = sinNodos(g, [nodo]);
    const gigante = new Set(componenteGigante(trabajo));
    const aislados = trabajo.nodos.filter((x) => !gigante.has(x)).sort();
    return {nodo, grado: grado(g, nodo), nodos_aislados: aislados.length, aislados,
      fraccion_gigante: gigante.size / n, es_articulacion: articulaciones.has(nodo)};
  }).sort((a, b) => b.nodos_aislados - a.nodos_aislados || compararTexto(a.nodo, b.nodo));
}

/** Cascada de sobrecargas de Motter y Lai: capacidad = (1 + tolerancia) · carga inicial. */
export function cascadaMotterLai(g, nodosIniciales, tolerancia, {rondasMaximas = 1000} = {}) {
  const n = g.nodos.length;
  const cargaInicial = intermediacion(g, {normalizada: false});
  const capacidad = Object.fromEntries(Object.entries(cargaInicial).map(([k, v]) => [k, (1 + tolerancia) * v]));
  let trabajo = sinNodos(g, nodosIniciales);
  const fallasPorRonda = [[...nodosIniciales]];
  for (let ronda = 0; ronda < rondasMaximas; ronda++) {
    const cargas = intermediacion(trabajo, {normalizada: false});
    const sobrecargados = trabajo.nodos
      .filter((x) => cargas[x] > capacidad[x] + 1e-9 * Math.max(1, capacidad[x]))
      .sort(compararTexto);
    if (!sobrecargados.length) break;
    trabajo = sinNodos(trabajo, sobrecargados);
    fallasPorRonda.push(sobrecargados);
  }
  return {fraccion_sobreviviente: n ? componenteGigante(trabajo).length / n : 0,
    fraccion_operativa: n ? trabajo.nodos.length / n : 0,
    fallas_por_ronda: fallasPorRonda, carga_inicial: cargaInicial, capacidad, grafo_final: trabajo};
}

// ----------------------------------------------------------------------
// Generadores con semilla y colas pesadas
// ----------------------------------------------------------------------

/** Generador congruencial lineal: números en [0, 1) reproducibles. */
export function azar(semilla = 1) {
  let estado = (semilla >>> 0) || 1;
  return () => { estado = (estado * 1664525 + 1013904223) >>> 0; return estado / 4294967296; };
}

/** Red aleatoria de Erdős y Rényi G(n, p). */
export function erdosRenyi(n, p, semilla = 1) {
  const u = azar(semilla), aristas = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (u() < p) aristas.push([i, j]);
  return grafo(aristas, [...Array(n).keys()]);
}

/** Red G(n, m): m aristas distintas tomadas al azar. */
export function redAleatoriaConMAristas(n, m, semilla = 1) {
  const u = azar(semilla), vistas = new Set(), aristas = [];
  while (aristas.length < m) {
    const i = Math.floor(u() * n), j = Math.floor(u() * n);
    if (i === j) continue;
    const k = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (vistas.has(k)) continue;
    vistas.add(k); aristas.push([Math.min(i, j), Math.max(i, j)]);
  }
  return grafo(aristas, [...Array(n).keys()]);
}

/** Red libre de escala de Barabási y Albert: m enlaces por nodo nuevo, con apego preferencial. */
export function barabasiAlbert(n, m, semilla = 1) {
  const u = azar(semilla), aristas = [], repetidos = [];
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) { aristas.push([i, j]); repetidos.push(i, j); }
  for (let nuevo = m; nuevo < n; nuevo++) {
    const elegidos = new Set();
    while (elegidos.size < m) elegidos.add(repetidos[Math.floor(u() * repetidos.length)]);
    for (const objetivo of elegidos) { aristas.push([objetivo, nuevo]); repetidos.push(objetivo, nuevo); }
  }
  return grafo(aristas, [...Array(n).keys()]);
}

/** Anillo regular: cada nodo unido a sus k vecinos más cercanos. */
export function anilloRegular(n, k) {
  const aristas = [];
  for (let i = 0; i < n; i++) for (let s = 1; s <= k / 2; s++) aristas.push([i, (i + s) % n]);
  return grafo(aristas, [...Array(n).keys()]);
}

/** Red de Watts y Strogatz: anillo regular con probabilidad p de recablear cada arista. */
export function wattsStrogatz(n, k, p, semilla = 1) {
  const u = azar(semilla);
  const vecinos = new Map([...Array(n).keys()].map((i) => [i, new Set()]));
  const unir = (a, b) => { vecinos.get(a).add(b); vecinos.get(b).add(a); };
  for (let i = 0; i < n; i++) for (let s = 1; s <= k / 2; s++) unir(i, (i + s) % n);
  for (let s = 1; s <= k / 2; s++) for (let i = 0; i < n; i++) {
    const j = (i + s) % n;
    if (u() >= p) continue;
    let nuevo = Math.floor(u() * n), intentos = 0;
    while ((nuevo === i || vecinos.get(i).has(nuevo)) && intentos++ < 50) nuevo = Math.floor(u() * n);
    if (nuevo === i || vecinos.get(i).has(nuevo)) continue;
    vecinos.get(i).delete(j); vecinos.get(j).delete(i); unir(i, nuevo);
  }
  const aristas = [];
  for (const [a, vs] of vecinos) for (const b of vs) if (a < b) aristas.push([a, b]);
  return grafo(aristas, [...Array(n).keys()]);
}

/** Coeficiente sigma de mundo pequeño frente a redes G(n, m) equivalentes. */
export function sigmaMundoPequeno(g, {repeticiones = 20, semilla = 1} = {}) {
  const agrupamiento = agrupamientoMedio(g), {longitudMedia} = distanciasGigante(g);
  let sumaC = 0, sumaL = 0;
  for (let r = 0; r < repeticiones; r++) {
    const aleatoria = redAleatoriaConMAristas(g.nodos.length, numeroDeAristas(g), semilla + r);
    sumaC += agrupamientoMedio(aleatoria);
    sumaL += distanciasGigante(aleatoria).longitudMedia;
  }
  const c = sumaC / repeticiones, l = sumaL / repeticiones, n = g.nodos.length, k = gradoMedio(g);
  return {agrupamiento, longitud_media: longitudMedia, agrupamiento_aleatorio: c, longitud_media_aleatoria: l,
    agrupamiento_teorico: k / n, longitud_teorica: k > 1 ? Math.log(n) / Math.log(k) : Infinity,
    sigma: c > 0 ? (agrupamiento / c) / (longitudMedia / l) : Infinity};
}

/** Muestra de una ley de potencias por transformada inversa. */
export function muestraLeyPotencia(tamano, exponente, {minimo = 1, semilla = 1} = {}) {
  const u = azar(semilla), salida = [];
  for (let i = 0; i < tamano; i++) salida.push(minimo * Math.pow(1 - u(), -1 / (exponente - 1)));
  return salida;
}

/** Exponente de una ley de potencias por máxima verosimilitud (Clauset et al., 2009). */
export function exponenteLeyPotencia(datos, minimo) {
  const x = datos.filter((v) => v >= minimo);
  if (x.length < 2) throw new Error("Se necesitan al menos dos datos por encima del mínimo.");
  const alfa = 1 + x.length / x.reduce((a, v) => a + Math.log(v / minimo), 0);
  return {alfa, error_estandar: (alfa - 1) / Math.sqrt(x.length)};
}

// ----------------------------------------------------------------------
// Puentes, caminos y cortes mínimos
// ----------------------------------------------------------------------

/** Puentes: aristas cuya salida desconecta la red. Devuelve pares [a, b] con a < b. */
export function puentes(g) {
  const visitado = new Set(), tin = new Map(), low = new Map(), salida = [];
  let tiempo = 0;
  const recorrer = (v, padre) => {
    visitado.add(v); tin.set(v, tiempo); low.set(v, tiempo); tiempo++;
    let saltadoPadre = false;
    for (const w of g.vecinos.get(v)) {
      if (w === padre && !saltadoPadre) { saltadoPadre = true; continue; }
      if (visitado.has(w)) { low.set(v, Math.min(low.get(v), tin.get(w))); continue; }
      recorrer(w, v);
      low.set(v, Math.min(low.get(v), low.get(w)));
      if (low.get(w) > tin.get(v)) salida.push(compararTexto(v, w) < 0 ? [v, w] : [w, v]);
    }
  };
  for (const n of g.nodos) if (!visitado.has(n)) recorrer(n, null);
  return salida.sort((x, y) => compararTexto(x[0], y[0]) || compararTexto(x[1], y[1]));
}

/** Camino más corto en saltos entre dos nodos (lista de nodos, o null si no hay). */
export function caminoMasCorto(g, origen, destino) {
  const previo = new Map([[origen, null]]), cola = [origen];
  for (let i = 0; i < cola.length; i++) {
    const v = cola[i];
    if (v === destino) break;
    for (const w of g.vecinos.get(v)) if (!previo.has(w)) { previo.set(w, v); cola.push(w); }
  }
  if (!previo.has(destino)) return null;
  const camino = [];
  for (let x = destino; x !== null; x = previo.get(x)) camino.unshift(x);
  return camino;
}

/** Máximo flujo con capacidades enteras (Edmonds y Karp); devuelve el valor y el corte. */
function _flujoMaximo(aristas, fuente, sumidero) {
  const grafo = new Map(), lista = [];
  const agregar = (u, v, cap) => {
    if (!grafo.has(u)) grafo.set(u, []);
    if (!grafo.has(v)) grafo.set(v, []);
    grafo.get(u).push(lista.length); lista.push({v, cap, flujo: 0});
    grafo.get(v).push(lista.length); lista.push({v: u, cap: 0, flujo: 0});
  };
  for (const [u, v, cap] of aristas) agregar(u, v, cap);
  let valor = 0;
  for (;;) {
    const previo = new Map([[fuente, -1]]), cola = [fuente];
    for (let i = 0; i < cola.length && !previo.has(sumidero); i++) {
      for (const idx of grafo.get(cola[i]) ?? []) {
        const e = lista[idx];
        if (e.cap - e.flujo > 1e-9 && !previo.has(e.v)) { previo.set(e.v, idx); cola.push(e.v); }
      }
    }
    if (!previo.has(sumidero)) {
      const alcanzables = new Set(previo.keys());
      return {valor, alcanzables};
    }
    let cuello = Infinity;
    for (let x = sumidero; x !== fuente; ) { const idx = previo.get(x); const e = lista[idx];
      cuello = Math.min(cuello, e.cap - e.flujo); x = lista[idx ^ 1].v; }
    for (let x = sumidero; x !== fuente; ) { const idx = previo.get(x);
      lista[idx].flujo += cuello; lista[idx ^ 1].flujo -= cuello; x = lista[idx ^ 1].v; }
    valor += cuello;
  }
}

/** Corte mínimo de aristas entre dos grupos de nodos (réplica de corte_minimo_entre_grupos). */
export function corteMinimoAristas(g, grupoA, grupoB) {
  const enA = new Set(grupoA), enB = new Set(grupoB);
  const aristas = [];
  for (const [u, vs] of g.vecinos) for (const v of vs) if (compararTexto(u, v) < 0) {
    aristas.push([u, v, 1], [v, u, 1]);
  }
  for (const n of enA) aristas.push(["__fuente__", n, Infinity]);
  for (const n of enB) aristas.push([n, "__sumidero__", Infinity]);
  const {alcanzables} = _flujoMaximo(aristas, "__fuente__", "__sumidero__");
  const corte = [];
  for (const [u, vs] of g.vecinos) for (const v of vs) if (compararTexto(u, v) < 0) {
    if (alcanzables.has(u) !== alcanzables.has(v)) corte.push([u, v]);
  }
  return corte.sort((x, y) => compararTexto(x[0], y[0]) || compararTexto(x[1], y[1]));
}

/** Corte mínimo de vértices entre dos grupos: nodos cuya salida simultánea los separa. */
export function corteMinimoVertices(g, grupoA, grupoB) {
  const enA = new Set(grupoA), enB = new Set(grupoB);
  const lado = (n) => (enA.has(n) ? "__fuente__" : enB.has(n) ? "__sumidero__" : null);
  const aristas = [];
  const interiores = g.nodos.filter((n) => lado(n) === null);
  for (const n of interiores) aristas.push([`${n}|in`, `${n}|out`, 1]);
  const punta = (n, extremo) => lado(n) ?? `${n}|${extremo}`;
  for (const [u, vs] of g.vecinos) for (const v of vs) if (compararTexto(u, v) < 0) {
    if (lado(u) && lado(u) === lado(v)) continue;
    aristas.push([punta(u, "out"), punta(v, "in"), Infinity], [punta(v, "out"), punta(u, "in"), Infinity]);
  }
  const {alcanzables} = _flujoMaximo(aristas, "__fuente__", "__sumidero__");
  return interiores.filter((n) => alcanzables.has(`${n}|in`) && !alcanzables.has(`${n}|out`)).sort(compararTexto);
}
