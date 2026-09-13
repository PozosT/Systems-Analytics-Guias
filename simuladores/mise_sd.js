// mise_sd.js — Réplica en JavaScript del núcleo de mise_sd para los
// simuladores de las guías de autoestudio.
//
// Los simuladores corren en el navegador del estudiante (celdas OJS de
// Quarto), sin servidor. Para que muestren exactamente lo mismo que el
// módulo de Python del curso, este archivo replica sus piezas con los
// mismos nombres y ecuaciones, y la prueba
// codigo/tests/test_simuladores_guias.py compara ambas implementaciones.
// Toda función nueva que se agregue aquí debe tener su comparación en esa
// prueba.

// ----------------------------------------------------------------------
// Núcleo: modelo declarativo e integración
// ----------------------------------------------------------------------

/**
 * Integra un modelo declarativo con Euler explícito o Runge-Kutta 4.
 *
 * El modelo tiene la misma forma que mise_sd.core.Modelo:
 *   { constantes: {nombre: valor},
 *     stocks: [{nombre, inicial, entradas: [...], salidas: [...]}],
 *     auxiliares: [[nombre, (t, e) => valor], ...],   // en orden
 *     flujos: [[nombre, (t, e) => valor], ...] }       // en orden
 *
 * Devuelve {tiempo: [...], variables: {nombre: [...]}} con stocks,
 * constantes, auxiliares y flujos evaluados en cada instante de la malla.
 */
export function simular(modelo, {tFinal, paso = 0.05, metodo = "rk4", tInicial = 0} = {}) {
  const nombres = modelo.stocks.map((s) => s.nombre);
  const numeroPasos = Math.round((tFinal - tInicial) / paso);
  let y = modelo.stocks.map((s) => s.inicial);
  const tiempo = [];
  const variables = {};

  const evaluar = (t, valores) => {
    const e = {...modelo.constantes};
    nombres.forEach((n, i) => { e[n] = valores[i]; });
    for (const [n, f] of modelo.auxiliares) e[n] = f(t, e);
    for (const [n, f] of modelo.flujos) e[n] = f(t, e);
    return e;
  };
  const derivadas = (t, valores) => {
    const e = evaluar(t, valores);
    return modelo.stocks.map((s) =>
      s.entradas.reduce((a, n) => a + e[n], 0) - (s.salidas ?? []).reduce((a, n) => a + e[n], 0));
  };
  const registrar = (t, valores) => {
    tiempo.push(t);
    const e = evaluar(t, valores);
    for (const [n, v] of Object.entries(e)) (variables[n] ??= []).push(v);
  };

  for (let k = 0; k <= numeroPasos; k++) {
    const t = tInicial + k * paso;
    registrar(t, y);
    if (k === numeroPasos) break;
    if (metodo === "euler") {
      const d = derivadas(t, y);
      y = y.map((v, i) => v + paso * d[i]);
    } else {
      const k1 = derivadas(t, y);
      const k2 = derivadas(t + paso / 2, y.map((v, i) => v + paso / 2 * k1[i]));
      const k3 = derivadas(t + paso / 2, y.map((v, i) => v + paso / 2 * k2[i]));
      const k4 = derivadas(t + paso, y.map((v, i) => v + paso * k3[i]));
      y = y.map((v, i) => v + paso / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
  }
  return {tiempo, variables};
}

/** Convierte un resultado en filas {tiempo, variable, valor} para Plot. */
export function filasLargas(resultado, nombres, etiquetas = {}) {
  const filas = [];
  for (const n of nombres) {
    resultado.variables[n].forEach((v, k) =>
      filas.push({tiempo: resultado.tiempo[k], variable: etiquetas[n] ?? n, valor: v}));
  }
  return filas;
}

// ----------------------------------------------------------------------
// Funciones de entrada y retardos (réplica de mise_sd.retardos)
// ----------------------------------------------------------------------

export const malla = (tFinal, paso, tInicial = 0) =>
  Array.from({length: Math.round((tFinal - tInicial) / paso) + 1}, (_, k) => tInicial + k * paso);

export const escalon = (tiempo, tInicio = 0, altura = 1, base = 0) =>
  tiempo.map((t) => (t >= tInicio ? base + altura : base));

// La tolerancia replica el redondeo de la malla de numpy (np.arange)
const EPS = 1e-9;
export const pulso = (tiempo, tInicio, duracion, altura = 1, base = 0) =>
  tiempo.map((t) => (t >= tInicio - EPS && t < tInicio + duracion - EPS ? base + altura : base));

export function retardoPrimerOrden(tiempo, entrada, tau, salidaInicial = null) {
  const salida = [salidaInicial ?? entrada[0]];
  for (let k = 0; k < tiempo.length - 1; k++) {
    const paso = tiempo[k + 1] - tiempo[k];
    salida.push(salida[k] + paso * (entrada[k] - salida[k]) / tau);
  }
  return salida;
}

export function retardoOrdenN(tiempo, entrada, tau, n = 3, salidaInicial = null) {
  const etapas = Array(n).fill(salidaInicial ?? entrada[0]);
  const tauEtapa = tau / n;
  const salida = [etapas[n - 1]];
  for (let k = 0; k < tiempo.length - 1; k++) {
    const paso = tiempo[k + 1] - tiempo[k];
    let alimentacion = entrada[k];
    for (let j = 0; j < n; j++) {
      etapas[j] = etapas[j] + paso * (alimentacion - etapas[j]) / tauEtapa;
      alimentacion = etapas[j];
    }
    salida.push(etapas[n - 1]);
  }
  return salida;
}

export function retardoPipeline(tiempo, entrada, tau, valorPrevio = null) {
  const relleno = valorPrevio ?? entrada[0];
  return tiempo.map((t) => {
    const buscado = t - tau;
    if (buscado < tiempo[0]) return relleno;
    if (buscado >= tiempo[tiempo.length - 1]) return entrada[entrada.length - 1];
    // búsqueda binaria e interpolación lineal, como np.interp
    let izq = 0, der = tiempo.length - 1;
    while (der - izq > 1) {
      const medio = (izq + der) >> 1;
      if (tiempo[medio] <= buscado) izq = medio; else der = medio;
    }
    const f = (buscado - tiempo[izq]) / (tiempo[der] - tiempo[izq]);
    return entrada[izq] + f * (entrada[der] - entrada[izq]);
  });
}

/** Área bajo una serie muestreada (regla del trapecio). */
export function area(tiempo, serie) {
  let total = 0;
  for (let k = 0; k < tiempo.length - 1; k++)
    total += (tiempo[k + 1] - tiempo[k]) * (serie[k] + serie[k + 1]) / 2;
  return total;
}

// ----------------------------------------------------------------------
// Modelos canónicos (réplica de mise_sd.modelos)
// ----------------------------------------------------------------------

export const PARAMETROS_CICLO = {
  capacidad_inicial: 12000, proyectos_iniciales: 2500, demanda_inicial: 8000,
  crecimiento_demanda: 0.03, margen_objetivo: 0.30, retardo_constructor: 4,
  vida_util: 30, precio_referencia: 150, sensibilidad_precio: 4,
  elasticidad_inversion: 3, elasticidad_demanda: 0,
};

/** Modelo de tres stocks del ciclo inversión-capacidad (semana 4). */
export function cicloInversionCapacidad(parametros = {}) {
  const p = {...PARAMETROS_CICLO, ...parametros};
  return {
    nombre: "ciclo_inversion_capacidad",
    constantes: {
      crecimiento_demanda_anual: p.crecimiento_demanda,
      margen_objetivo: p.margen_objetivo,
      retardo_constructor: p.retardo_constructor,
      vida_util: p.vida_util,
      precio_referencia: p.precio_referencia,
      sensibilidad_precio: p.sensibilidad_precio,
      elasticidad_inversion: p.elasticidad_inversion,
      elasticidad_demanda: p.elasticidad_demanda,
      tasa_inversion_referencia: 1 / p.vida_util + p.crecimiento_demanda,
    },
    stocks: [
      {nombre: "capacidad_instalada", inicial: p.capacidad_inicial,
        entradas: ["puesta_en_servicio"], salidas: ["retiros"]},
      {nombre: "proyectos_en_construccion", inicial: p.proyectos_iniciales,
        entradas: ["inicio_proyectos"], salidas: ["puesta_en_servicio"]},
      {nombre: "demanda", inicial: p.demanda_inicial,
        entradas: ["crecimiento_demanda"], salidas: []},
    ],
    auxiliares: [
      ["margen_reserva", (t, e) => (e.capacidad_instalada - e.demanda) / e.demanda],
      ["precio_bolsa", (t, e) => e.precio_referencia
        * Math.exp(-e.sensibilidad_precio * (e.margen_reserva - e.margen_objetivo))],
    ],
    flujos: [
      ["inicio_proyectos", (t, e) => e.tasa_inversion_referencia * e.capacidad_instalada
        * (e.precio_bolsa / e.precio_referencia) ** e.elasticidad_inversion],
      ["puesta_en_servicio", (t, e) => e.proyectos_en_construccion / e.retardo_constructor],
      ["retiros", (t, e) => e.capacidad_instalada / e.vida_util],
      ["crecimiento_demanda", (t, e) => e.crecimiento_demanda_anual * e.demanda
        * (e.precio_bolsa / e.precio_referencia) ** (-e.elasticidad_demanda)],
    ],
  };
}

/**
 * Valles (mínimos locales) de una serie con una prominencia mínima.
 * Sirve para leer en el simulador cuándo ocurre cada escasez y qué tan
 * profunda es. Replica en lo esencial scipy.signal.find_peaks(-serie,
 * prominence=...) para series suaves.
 */
export function valles(tiempo, serie, prominencia = 0.003) {
  const encontrados = [];
  for (let k = 1; k < serie.length - 1; k++) {
    if (!(serie[k] < serie[k - 1] && serie[k] <= serie[k + 1])) continue;
    let maxIzq = serie[k], maxDer = serie[k];
    for (let j = k - 1; j >= 0 && serie[j] >= serie[k]; j--) maxIzq = Math.max(maxIzq, serie[j]);
    for (let j = k + 1; j < serie.length && serie[j] >= serie[k]; j++) maxDer = Math.max(maxDer, serie[j]);
    if (Math.min(maxIzq, maxDer) - serie[k] >= prominencia)
      encontrados.push({tiempo: tiempo[k], valor: serie[k]});
  }
  return encontrados;
}

// ----------------------------------------------------------------------
// Sistemas mínimos de las guías (sin contraparte en mise_sd)
// ----------------------------------------------------------------------

/**
 * La ducha del hotel en tiempo discreto (semana 4, retardos).
 *
 * Cada `paso` segundos la persona siente la temperatura T_k, que
 * corresponde a la posición de la llave de hace `pasosRetardo` pasos, y
 * gira la llave en proporción al error: u_{k+1} = u_k + g·(meta − T_k)/50,
 * con u acotada entre 0 (fría) y 1 (caliente) y T = 10 + 50·u [°C].
 */
export function ducha({agresividad = 1, pasosRetardo = 2, llaveInicial = 0.2,
  meta = 38, numeroPasos = 18, paso = 10} = {}) {
  const temperatura = (u) => 10 + 50 * u;
  const llave = Array(pasosRetardo + 1).fill(llaveInicial);
  const filas = [];
  for (let k = 0; k < numeroPasos; k++) {
    const actual = llave[llave.length - 1];
    const sentida = temperatura(llave[llave.length - 1 - pasosRetardo]);
    const error = meta - sentida;
    const nueva = Math.min(1, Math.max(0, actual + agresividad * error / 50));
    filas.push({tiempo: k * paso, llave: actual, temperatura: sentida, error, llaveNueva: nueva});
    llave.push(nueva);
  }
  return filas;
}
