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
// Formato numérico del curso: coma decimal y espacio fino como separador de miles
// ----------------------------------------------------------------------

/** Devuelve una función que formatea números con `decimales` fijos: 19 107,7. */
export const formatoNumero = (decimales = 0) => (d) =>
  d.toLocaleString("es-CO", {minimumFractionDigits: decimales, maximumFractionDigits: decimales})
    .replace(/\./g, "\u202F");

/** Formatea una fracción como porcentaje con espacio antes del signo: 25,0 %. */
export const formatoPorcentaje = (d, decimales = 0) => `${formatoNumero(decimales)(100 * d)} %`;

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

/** Interpolación lineal de una serie en los instantes pedidos (como np.interp). */
export function interpolar(instantes, tiempo, serie) {
  return instantes.map((x) => {
    if (x <= tiempo[0]) return serie[0];
    if (x >= tiempo[tiempo.length - 1]) return serie[serie.length - 1];
    let izq = 0, der = tiempo.length - 1;
    while (der - izq > 1) { const medio = (izq + der) >> 1; if (tiempo[medio] <= x) izq = medio; else der = medio; }
    const f = (x - tiempo[izq]) / (tiempo[der] - tiempo[izq]);
    return serie[izq] + f * (serie[der] - serie[izq]);
  });
}

/** Recta de mínimos cuadrados y = intercepto + pendiente · x (como np.polyfit de grado 1). */
export function regresionLineal(x, y) {
  const n = x.length;
  const mx = x.reduce((a, v) => a + v, 0) / n;
  const my = y.reduce((a, v) => a + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; }
  const pendiente = sxy / sxx;
  return {pendiente, intercepto: my - pendiente * mx};
}

/** Raíz del error cuadrático medio entre dos series de igual longitud. */
export function rmse(modelo, observado) {
  const suma = modelo.reduce((a, v, k) => a + (v - observado[k]) ** 2, 0);
  return Math.sqrt(suma / modelo.length);
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

export const PARAMETROS_MERCADO = {
  capacidad_firme_inicial: 13000, proyectos_firme_iniciales: 2700, retardo_constructor_firme: 4, vida_util_firme: 30,
  capacidad_fncer_inicial: 100, proyectos_fncer_iniciales: 50, retardo_constructor_fncer: 1.5, vida_util_fncer: 25,
  costo_fncer_inicial: 300, tasa_aprendizaje: 0.20, credito_capacidad_fncer: 0.30, elasticidad_fncer: 3,
  semilla_mercado_fncer: 200, canibalizacion: 2,
  demanda_inicial: 11000, crecimiento_demanda: 0.03, margen_objetivo: 0.30, precio_referencia: 150,
  sensibilidad_precio: 4, elasticidad_inversion: 3,
  periodo_nino: 0, duracion_nino: 1.5, intensidad_nino: 0.10,
  prima_cxc: 0, subasta_fncer: 0, impuesto_carbono: 0, inicio_subasta: 0, duracion_subasta: null,
};

/** Ciclo con CxC, FNCER y aprendizaje (semana 5; réplica de mise_sd.modelos.mercado_con_politicas). */
export function mercadoConPoliticas(parametros = {}) {
  const p = {...PARAMETROS_MERCADO, ...parametros};
  const acumuladaInicial = Math.max(p.capacidad_fncer_inicial, 1);
  return {
    nombre: "mercado_con_politicas",
    constantes: {
      crecimiento_demanda_anual: p.crecimiento_demanda, margen_objetivo: p.margen_objetivo,
      retardo_firme: p.retardo_constructor_firme, retardo_fncer: p.retardo_constructor_fncer,
      vida_firme: p.vida_util_firme, vida_fncer: p.vida_util_fncer,
      precio_referencia: p.precio_referencia, sensibilidad_precio: p.sensibilidad_precio,
      elasticidad_inversion: p.elasticidad_inversion, elasticidad_fncer: p.elasticidad_fncer,
      credito_fncer: p.credito_capacidad_fncer, costo_fncer_inicial: p.costo_fncer_inicial,
      fncer_acumulada_inicial: acumuladaInicial, exponente_wright: Math.log2(1 / (1 - p.tasa_aprendizaje)),
      semilla_fncer: p.semilla_mercado_fncer, canibalizacion: p.canibalizacion,
      tasa_firme: 1 / p.vida_util_firme + p.crecimiento_demanda, tasa_fncer: 1 / p.vida_util_fncer + p.crecimiento_demanda,
      prima_cxc: p.prima_cxc, subasta_fncer: p.subasta_fncer, impuesto_carbono: p.impuesto_carbono,
      inicio_subasta: p.inicio_subasta, fin_subasta: p.duracion_subasta === null ? Infinity : p.inicio_subasta + p.duracion_subasta,
      periodo_nino: p.periodo_nino, duracion_nino: p.duracion_nino, intensidad_nino: p.intensidad_nino,
    },
    stocks: [
      {nombre: "capacidad_firme", inicial: p.capacidad_firme_inicial, entradas: ["puesta_firme"], salidas: ["retiros_firme"]},
      {nombre: "proyectos_firme", inicial: p.proyectos_firme_iniciales, entradas: ["inicios_firme"], salidas: ["puesta_firme"]},
      {nombre: "capacidad_fncer", inicial: p.capacidad_fncer_inicial, entradas: ["puesta_fncer"], salidas: ["retiros_fncer"]},
      {nombre: "proyectos_fncer", inicial: p.proyectos_fncer_iniciales, entradas: ["inicios_fncer"], salidas: ["puesta_fncer"]},
      {nombre: "fncer_acumulada", inicial: acumuladaInicial, entradas: ["puesta_fncer_acumulada"], salidas: []},
      {nombre: "demanda", inicial: p.demanda_inicial, entradas: ["crecimiento_demanda"], salidas: []},
    ],
    auxiliares: [
      ["capacidad_equivalente", (t, e) => e.capacidad_firme + e.credito_fncer * e.capacidad_fncer],
      ["factor_nino", (t, e) => 1 + (e.periodo_nino > 0 && (t % e.periodo_nino) < e.duracion_nino ? e.intensidad_nino : 0)],
      ["demanda_efectiva", (t, e) => e.demanda * e.factor_nino],
      ["margen_reserva", (t, e) => (e.capacidad_equivalente - e.demanda_efectiva) / e.demanda_efectiva],
      ["precio_bolsa", (t, e) => e.precio_referencia * Math.exp(-e.sensibilidad_precio * (e.margen_reserva - e.margen_objetivo))],
      ["costo_fncer", (t, e) => e.costo_fncer_inicial * (e.fncer_acumulada / e.fncer_acumulada_inicial) ** (-e.exponente_wright)],
      ["penetracion_fncer", (t, e) => e.capacidad_fncer / e.demanda],
      ["precio_capturado_fncer", (t, e) => e.precio_bolsa * Math.exp(-e.canibalizacion * e.penetracion_fncer)],
      ["ingreso_firme", (t, e) => Math.max(e.precio_bolsa + e.prima_cxc - e.impuesto_carbono, 1)],
    ],
    flujos: [
      ["inicios_firme", (t, e) => e.tasa_firme * e.capacidad_firme * (e.ingreso_firme / e.precio_referencia) ** e.elasticidad_inversion],
      ["puesta_firme", (t, e) => e.proyectos_firme / e.retardo_firme],
      ["retiros_firme", (t, e) => e.capacidad_firme / e.vida_firme],
      ["inicios_fncer", (t, e) => e.tasa_fncer * Math.max(e.capacidad_fncer, e.semilla_fncer)
        * (e.precio_capturado_fncer / e.costo_fncer) ** e.elasticidad_fncer
        + (e.inicio_subasta <= t && t < e.fin_subasta ? e.subasta_fncer : 0)],
      ["puesta_fncer", (t, e) => e.proyectos_fncer / e.retardo_fncer],
      ["puesta_fncer_acumulada", (t, e) => e.puesta_fncer],
      ["retiros_fncer", (t, e) => e.capacidad_fncer / e.vida_fncer],
      ["crecimiento_demanda", (t, e) => e.crecimiento_demanda_anual * e.demanda],
    ],
  };
}

/** Escenarios, estrategias y métrica del Laboratorio 4 (réplica de notas/semana5/figuras/escenarios_lab4.py). */
export const ESCENARIOS_LAB4 = {
  "Viento a favor": {tasa_aprendizaje: 0.25, credito_capacidad_fncer: 0.40, crecimiento_demanda: 0.02, periodo_nino: 7, intensidad_nino: 0.10},
  "Contrarreloj": {tasa_aprendizaje: 0.25, credito_capacidad_fncer: 0.40, crecimiento_demanda: 0.045, periodo_nino: 4, intensidad_nino: 0.15},
  "Siesta": {tasa_aprendizaje: 0.10, credito_capacidad_fncer: 0.20, crecimiento_demanda: 0.02, periodo_nino: 7, intensidad_nino: 0.10},
  "Tormenta": {tasa_aprendizaje: 0.10, credito_capacidad_fncer: 0.20, crecimiento_demanda: 0.045, periodo_nino: 4, intensidad_nino: 0.15},
};
export const ESTRATEGIAS_LAB4 = {"mercado solo": {}, "seguro CxC": {prima_cxc: 50}, "impulso FNCER": {subasta_fncer: 300}};
export const MARGEN_CRITICO = 0.12;
export const COSTO_RACIONAMIENTO = 1500;
export const RELACION_FACTORES_CARGA = 0.30;

/** Costo medio para la demanda [COP/kWh] de una corrida (réplica de escenarios_lab4.costo_para_demanda). */
export function costoParaDemanda(resultado, {prima_cxc = 0, subasta_fncer = 0} = {}) {
  const v = resultado.variables;
  const media = (serie) => serie.reduce((a, x) => a + x, 0) / serie.length;
  const racionamiento = COSTO_RACIONAMIENTO * media(v.margen_reserva.map((m) => Math.max(0, MARGEN_CRITICO - m)));
  let sobrecosto = 0;
  if (subasta_fncer > 0) {
    sobrecosto = media(resultado.tiempo.map((t, k) => {
      const subastada = Math.min(v.capacidad_fncer[k], subasta_fncer * t);
      const porcion = RELACION_FACTORES_CARGA * subastada / v.demanda[k];
      return Math.max(0, v.costo_fncer[k] - v.precio_bolsa[k]) * porcion;
    }));
  }
  return media(v.precio_bolsa) + prima_cxc + sobrecosto + racionamiento;
}

/** Adopción logística de solar en techos (réplica de mise_sd.modelos.adopcion_logistica). */
export function adopcionLogistica({techos = 10000, contagio = 0.5, adoptantes_iniciales = 20} = {}) {
  return {
    nombre: "adopcion_logistica",
    constantes: {techos, contagio},
    stocks: [{nombre: "adoptantes", inicial: adoptantes_iniciales, entradas: ["instalaciones"], salidas: []}],
    auxiliares: [["fraccion_disponible", (t, e) => 1 - e.adoptantes / e.techos]],
    flujos: [["instalaciones", (t, e) => e.contagio * e.adoptantes * e.fraccion_disponible]],
  };
}

/** La bañera de Sterman [L, min] (réplica de mise_sd.modelos.banera). */
export function banera({nivel_inicial = 80, caudal_grifo = 5, caudal_desague = 3, tau_desague = null} = {}) {
  return {
    nombre: "banera",
    constantes: {caudal_grifo, caudal_desague, tau_desague: tau_desague || 0},
    stocks: [{nombre: "nivel", inicial: nivel_inicial, entradas: ["entrada"], salidas: ["salida"]}],
    auxiliares: [],
    flujos: [
      ["entrada", (t, e) => e.caudal_grifo],
      ["salida", tau_desague ? (t, e) => e.nivel / e.tau_desague : (t, e) => e.caudal_desague],
    ],
  };
}

/**
 * Cobertura de contratos con retardo de negociación [GWh, años]
 * (réplica de mise_sd.modelos.cobertura_contratos).
 */
export function coberturaContratos({cobertura_inicial = 60, meta = 100, tiempo_ajuste = 0.5,
  retardo_negociacion = 0.5, etapas = 3} = {}) {
  const conRetardo = retardo_negociacion > 0;
  const stocks = [{nombre: "cobertura", inicial: cobertura_inicial,
    entradas: [conRetardo ? "firma" : "compras"], salidas: []}];
  const flujos = [["compras", (t, e) => e.brecha / e.tiempo_ajuste]];
  if (conRetardo) {
    for (let k = 1; k <= etapas; k++) {
      stocks.push({nombre: `negociacion_${k}`, inicial: 0,
        entradas: [k === 1 ? "compras" : `avance_${k - 1}`], salidas: [k === etapas ? "firma" : `avance_${k}`]});
    }
    for (let k = 1; k < etapas; k++)
      flujos.push([`avance_${k}`, (t, e) => e[`negociacion_${k}`] * etapas / e.retardo_negociacion]);
    flujos.push(["firma", (t, e) => e[`negociacion_${etapas}`] * etapas / e.retardo_negociacion]);
  }
  return {
    nombre: "cobertura_contratos",
    constantes: {meta, tiempo_ajuste, retardo_negociacion},
    stocks,
    auxiliares: [["brecha", (t, e) => e.meta - e.cobertura]],
    flujos,
  };
}

/** Embalse agregado del SIN [GWh, días] (réplica de mise_sd.modelos.embalse_agregado). */
export function embalseAgregado({energia_inicial = 12000, aportes_medios = 150, amplitud_aportes = 0,
  periodo_aportes = 365, turbinamiento = 180} = {}) {
  return {
    nombre: "embalse_agregado",
    constantes: {aportes_medios, amplitud_aportes, periodo_aportes, turbinamiento_constante: turbinamiento},
    stocks: [{nombre: "energia_embalsada", inicial: energia_inicial, entradas: ["aportes"], salidas: ["turbinamiento"]}],
    auxiliares: [],
    flujos: [
      ["aportes", (t, e) => e.aportes_medios + e.amplitud_aportes * Math.sin(2 * Math.PI * t / e.periodo_aportes)],
      ["turbinamiento", (t, e) => e.turbinamiento_constante],
    ],
  };
}

/**
 * Integración gráfica con flujos constantes por tramos (semana 4, concepto 2).
 * La entrada es constante y la salida cambia al inicio de cada tramo de
 * `duracion` unidades de tiempo. Devuelve la malla con entrada, salida y
 * nivel, integrado de forma exacta (el flujo neto es constante en cada tramo).
 */
export function balancePorTramos({nivel_inicial = 80, entrada = 5, salidas = [3, 8, 5], duracion = 10, paso = 0.5} = {}) {
  const filas = [];
  const tFinal = salidas.length * duracion;
  for (let k = 0; k <= Math.round(tFinal / paso); k++) {
    const t = k * paso;
    let nivel = nivel_inicial;
    for (let j = 0; j < salidas.length; j++) {
      const inicio = j * duracion;
      const dentro = Math.min(Math.max(t - inicio, 0), duracion);
      nivel += (entrada - salidas[j]) * dentro;
    }
    const tramo = Math.min(Math.floor(t / duracion), salidas.length - 1);
    filas.push({tiempo: t, entrada, salida: salidas[tramo], nivel});
  }
  return filas;
}

/** Stock que resulta de acumular flujos por periodo: S_k = S_0 + suma de flujos hasta k. */
export function acumular(inicial, flujos) {
  const stock = [inicial];
  flujos.forEach((f) => stock.push(stock[stock.length - 1] + f));
  return stock;
}

/** Ajuste de primer orden hacia una meta (réplica de mise_sd.modelos.ajuste_primer_orden). */
export function ajustePrimerOrden({valor_inicial = 100, meta = 0, tau = 4} = {}) {
  return {
    nombre: "ajuste_primer_orden",
    constantes: {meta, tau},
    stocks: [{nombre: "stock", inicial: valor_inicial, entradas: ["ajuste"], salidas: []}],
    auxiliares: [["brecha", (t, e) => e.meta - e.stock]],
    flujos: [["ajuste", (t, e) => e.brecha / e.tau]],
  };
}

/** Termostato con banda muerta [°C, h] (réplica de mise_sd.modelos.termostato). */
export function termostato({temperatura_inicial = 20, temperatura_exterior = 10, consigna = 20, media_banda = 1,
  calentamiento_maximo = 6, coeficiente_perdidas = 0.4, velocidad_conmutacion = 60} = {}) {
  return {
    nombre: "termostato",
    constantes: {temperatura_exterior, limite_inferior: consigna - media_banda, limite_superior: consigna + media_banda,
      calentamiento_maximo, coeficiente_perdidas, velocidad_conmutacion},
    stocks: [
      {nombre: "temperatura", inicial: temperatura_inicial, entradas: ["calefaccion"], salidas: ["perdidas"]},
      {nombre: "quemador", inicial: 0, entradas: ["conmutacion"], salidas: []},
    ],
    auxiliares: [],
    flujos: [
      ["conmutacion", (t, e) => {
        const objetivo = e.temperatura < e.limite_inferior ? 1
          : e.temperatura > e.limite_superior ? 0 : (e.quemador >= 0.5 ? 1 : 0);
        return e.velocidad_conmutacion * (objetivo - e.quemador);
      }],
      ["calefaccion", (t, e) => e.calentamiento_maximo * e.quemador],
      ["perdidas", (t, e) => e.coeficiente_perdidas * (e.temperatura - e.temperatura_exterior)],
    ],
  };
}

/** Población con natalidad y mortalidad (réplica de mise_sd.modelos.poblacion). */
export function poblacion({poblacion_inicial = 1000, natalidad = 0.02, esperanza_vida = 70} = {}) {
  return {
    nombre: "poblacion",
    constantes: {natalidad, esperanza_vida},
    stocks: [{nombre: "poblacion", inicial: poblacion_inicial, entradas: ["nacimientos"], salidas: ["muertes"]}],
    auxiliares: [],
    flujos: [
      ["nacimientos", (t, e) => e.natalidad * e.poblacion],
      ["muertes", (t, e) => e.poblacion / e.esperanza_vida],
    ],
  };
}

/** Tina con fuga, correcta o con el error de unidades (réplica de mise_sd.modelos.tina_con_fuga). */
export function tinaConFuga({nivel_inicial = 80, caudal_grifo = 5, tau_desague = 40, fuga = 0.02, fuga_proporcional = true} = {}) {
  return {
    nombre: "tina_con_fuga",
    constantes: {caudal_grifo, tau_desague, fuga},
    stocks: [{nombre: "nivel", inicial: nivel_inicial, entradas: ["entrada"], salidas: ["desague", "perdida"]}],
    auxiliares: [],
    flujos: [
      ["entrada", (t, e) => e.caudal_grifo],
      ["desague", (t, e) => e.nivel / e.tau_desague],
      ["perdida", fuga_proporcional ? (t, e) => e.fuga * e.nivel : (t, e) => e.fuga],
    ],
  };
}

/** Generación térmica de un despacho simplificado [GWh/día] (réplica de mise_sd.modelos.despacho_termico). */
export function despachoTermico({demanda, hidraulica, factor = 1.05, maximo_termico = null, con_topes = false}) {
  const bruta = factor * (demanda - hidraulica);
  if (!con_topes) return bruta;
  const acotada = Math.max(0, bruta);
  return maximo_termico === null ? acotada : Math.min(maximo_termico, acotada);
}

/** Precio de bolsa como función del margen (auxiliar del modelo del curso). */
export const precioMargen = (margen, {precio_referencia = 150, margen_objetivo = 0.30, sensibilidad_precio = 4} = {}) =>
  precio_referencia * Math.exp(-sensibilidad_precio * (margen - margen_objetivo));

/** Primer instante desde el cual la serie queda dentro de ±tolerancia de la meta. */
export function tiempoAsentamiento(tiempo, serie, meta, tolerancia = 1) {
  let ultimoFuera = -1;
  serie.forEach((v, k) => { if (Math.abs(v - meta) > tolerancia) ultimoFuera = k; });
  return ultimoFuera + 1 < tiempo.length ? tiempo[ultimoFuera + 1] : null;
}

/** Picos (máximos locales) con prominencia mínima: valles de la serie reflejada. */
export const picos = (tiempo, serie, prominencia = 0.003) =>
  valles(tiempo, serie.map((v) => -v), prominencia).map((d) => ({tiempo: d.tiempo, valor: -d.valor}));

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
