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
  // Misma malla que mise_sd.core.malla_temporal: si el horizonte no es
  // múltiplo del paso, el último paso es parcial y termina en tFinal.
  const instantes = malla(tFinal, paso, tInicial);
  const numeroPasos = instantes.length - 1;
  const parcial = numeroPasos > 0 && instantes[numeroPasos] !== tInicial + numeroPasos * paso;
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
    const t = instantes[k];
    registrar(t, y);
    if (k === numeroPasos) break;
    const h = parcial && k === numeroPasos - 1 ? instantes[k + 1] - t : paso;
    if (metodo === "euler") {
      const d = derivadas(t, y);
      y = y.map((v, i) => v + h * d[i]);
    } else {
      const k1 = derivadas(t, y);
      const k2 = derivadas(t + h / 2, y.map((v, i) => v + h / 2 * k1[i]));
      const k3 = derivadas(t + h / 2, y.map((v, i) => v + h / 2 * k2[i]));
      const k4 = derivadas(t + h, y.map((v, i) => v + h * k3[i]));
      y = y.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
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

/** Malla de tInicial a tFinal (réplica de mise_sd.core.malla_temporal): si el horizonte
 *  no es múltiplo del paso, agrega un último paso parcial que termina en tFinal. */
export function malla(tFinal, paso, tInicial = 0) {
  if (!(paso > 0)) throw new Error("El paso debe ser positivo.");
  if (!(tFinal > tInicial)) throw new Error("tFinal debe ser mayor que tInicial.");
  const cociente = (tFinal - tInicial) / paso, entero = Math.round(cociente);
  if (Math.abs(cociente - entero) <= 1e-9 * Math.max(1, cociente))
    return Array.from({length: entero + 1}, (_, k) => tInicial + k * paso);
  const completos = Math.floor(cociente);
  return [...Array.from({length: completos + 1}, (_, k) => tInicial + k * paso), tFinal];
}

export const escalon = (tiempo, tInicio = 0, altura = 1, base = 0) =>
  tiempo.map((t) => (t >= tInicio ? base + altura : base));

// La tolerancia replica el redondeo de la malla de numpy (np.arange)
const EPS = 1e-9;
export const pulso = (tiempo, tInicio, duracion, altura = 1, base = 0) =>
  tiempo.map((t) => (t >= tInicio - EPS && t < tInicio + duracion - EPS ? base + altura : base));

/** Euler explícito diverge si el paso llega al doble de la constante de cada etapa
 *  (réplica de `_verificar_paso_euler`; en el navegador no se emite la advertencia
 *  de oscilación, solo el error). */
function _verificarPasoEuler(tiempo, tauEtapa, nombre) {
  let paso = 0;
  for (let k = 0; k < tiempo.length - 1; k++) paso = Math.max(paso, tiempo[k + 1] - tiempo[k]);
  if (tiempo.length > 1 && paso >= 2 * tauEtapa)
    throw new Error(`${nombre}: el paso ${paso} es mayor o igual que el doble de la constante de cada etapa (${tauEtapa}); Euler explícito diverge.`);
}

export function retardoPrimerOrden(tiempo, entrada, tau, salidaInicial = null) {
  if (!(tau > 0)) throw new Error("La constante de tiempo tau debe ser positiva.");
  _verificarPasoEuler(tiempo, tau, "retardoPrimerOrden");
  const salida = [salidaInicial ?? entrada[0]];
  for (let k = 0; k < tiempo.length - 1; k++) {
    const paso = tiempo[k + 1] - tiempo[k];
    salida.push(salida[k] + paso * (entrada[k] - salida[k]) / tau);
  }
  return salida;
}

/** Retardo de orden n (réplica de retardo_orden_n): todas las etapas se alimentan
 *  con los valores del paso anterior, así el retardo medio discreto es exactamente tau. */
export function retardoOrdenN(tiempo, entrada, tau, n = 3, salidaInicial = null) {
  if (!(Number.isInteger(n) && n >= 1)) throw new Error("El orden n debe ser un entero positivo.");
  if (!(tau > 0)) throw new Error("La constante de tiempo tau debe ser positiva.");
  const tauEtapa = tau / n;
  _verificarPasoEuler(tiempo, tauEtapa, "retardoOrdenN");
  let etapas = Array(n).fill(salidaInicial ?? entrada[0]);
  const salida = [etapas[n - 1]];
  for (let k = 0; k < tiempo.length - 1; k++) {
    const paso = tiempo[k + 1] - tiempo[k];
    const alimentaciones = [entrada[k], ...etapas.slice(0, n - 1)];
    etapas = etapas.map((s, j) => s + paso * (alimentaciones[j] - s) / tauEtapa);
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

/** Energía [GWh] que entrega 1 MW operando un año completo (réplica de mise_sd.modelos.GWH_POR_MW_ANIO). */
export const GWH_POR_MW_ANIO = 8.76;

/** Factor estacional continuo de los aportes, media 1 por año (réplica de factor_estacional_aportes). */
export const factorEstacionalAportes = (t, amplitud) => (amplitud === 0 ? 1
  : 1 + amplitud * (Math.cos(4 * Math.PI * t - 1.5 * Math.PI) + 0.5 * Math.cos(2 * Math.PI * t - 1.25 * Math.PI)));

/** Margen de energía en el equilibrio de referencia (réplica de mise_sd.modelos.margen_energia_referencia). */
export const margenEnergiaReferencia = ({participacion_hidraulica = 0.65, factor_aportes = 0.62, disponibilidad_termica = 0.85,
  participacion_hidraulica_referencia = 0.80} = {}) => participacion_hidraulica_referencia
  + disponibilidad_termica * (1 - participacion_hidraulica) * participacion_hidraulica_referencia
  / (factor_aportes * participacion_hidraulica) - 1;

/** Curva de precio del modelo ancla: valor del agua por margen de energía (réplica de precio_bolsa_energia). */
export const precioBolsaEnergia = (nivel, margen, {precio_referencia = 150, nivel_referencia = 0.65, sensibilidad_precio = 3,
  sensibilidad_margen = 1, margen_referencia = null} = {}) => precio_referencia * Math.exp(
  -sensibilidad_precio * (nivel - nivel_referencia)
  - sensibilidad_margen * (margen - (margen_referencia ?? margenEnergiaReferencia())));

export const PARAMETROS_CICLO = {
  // Stocks iniciales (año 0 ≈ 2000)
  capacidad_inicial: 12700, proyectos_iniciales: 1500, demanda_inicial: 41500, nivel_embalse_inicial: 0.65,
  precio_esperado_inicial: null,
  // Demanda e inversión
  crecimiento_demanda: 0.03, elasticidad_demanda: 0, retardo_constructor: 4, vida_util: 30,
  // Parque y embalse
  participacion_hidraulica: 0.65, factor_aportes: 0.62, regulacion_embalse: 1.5, disponibilidad_termica: 0.85,
  participacion_hidraulica_referencia: 0.80, nivel_referencia: 0.65, factor_carga: 0.80,
  // Precio y expectativas
  precio_referencia: 150, sensibilidad_precio: 3, sensibilidad_margen: 1, precio_escasez: 400,
  elasticidad_inversion: 3, tiempo_expectativas: 1, respuesta_maxima_inversion: 10, peso_cartera: 0,
  // Hidrología (El Niño y estacionalidad apagados por omisión)
  periodo_nino: 0, duracion_nino: 1, intensidad_nino: 0.35, fase_nino: 15, rampa_nino: 0.25,
  amplitud_estacional: 0, factor_hidrologico: null,
};

/** Ciclo inversión-capacidad con energía embalsada, cinco stocks (semana 4; réplica de mise_sd.modelos.ciclo_inversion_capacidad). */
export function cicloInversionCapacidad(parametros = {}) {
  const p = {...PARAMETROS_CICLO, ...parametros};
  const h = p.participacion_hidraulica, rRef = p.participacion_hidraulica_referencia, c = GWH_POR_MW_ANIO;
  const capacidadPorDemanda = rRef / (c * p.factor_aportes * h);
  const hidrologia = p.factor_hidrologico ?? ((t) =>
    (1 - p.intensidad_nino * pulsoNino(t, p.periodo_nino, p.duracion_nino, p.fase_nino, p.rampa_nino))
    * factorEstacionalAportes(t, p.amplitud_estacional));
  return {
    nombre: "ciclo_inversion_capacidad",
    constantes: {
      gwh_por_mw_anio: c,
      crecimiento_demanda_anual: p.crecimiento_demanda,
      elasticidad_demanda: p.elasticidad_demanda,
      retardo_constructor: p.retardo_constructor,
      vida_util: p.vida_util,
      participacion_hidraulica: h,
      factor_aportes: p.factor_aportes,
      regulacion_embalse: p.regulacion_embalse,
      disponibilidad_termica: p.disponibilidad_termica,
      participacion_hidraulica_referencia: rRef,
      nivel_referencia: p.nivel_referencia,
      factor_carga: p.factor_carga,
      precio_referencia: p.precio_referencia,
      sensibilidad_precio: p.sensibilidad_precio,
      sensibilidad_margen: p.sensibilidad_margen,
      precio_escasez: p.precio_escasez,
      elasticidad_inversion: p.elasticidad_inversion,
      tiempo_expectativas: p.tiempo_expectativas,
      respuesta_maxima_inversion: p.respuesta_maxima_inversion,
      peso_cartera: p.peso_cartera,
      capacidad_por_demanda: capacidadPorDemanda,
      margen_energia_referencia: margenEnergiaReferencia(p),
      tasa_inversion_referencia: (1 / p.vida_util + p.crecimiento_demanda) * (1 + p.crecimiento_demanda * p.retardo_constructor),
    },
    stocks: [
      {nombre: "capacidad_instalada", inicial: p.capacidad_inicial,
        entradas: ["puesta_en_servicio"], salidas: ["retiros"]},
      {nombre: "proyectos_en_construccion", inicial: p.proyectos_iniciales,
        entradas: ["inicio_proyectos"], salidas: ["puesta_en_servicio"]},
      {nombre: "demanda", inicial: p.demanda_inicial, entradas: ["crecimiento_demanda"], salidas: []},
      {nombre: "energia_embalsada", inicial: p.nivel_embalse_inicial * p.regulacion_embalse * h * p.capacidad_inicial,
        entradas: ["aportes"], salidas: ["turbinamiento", "vertimiento"]},
      {nombre: "precio_esperado", inicial: p.precio_esperado_inicial ?? p.precio_referencia,
        entradas: ["ajuste_expectativa"], salidas: []},
    ],
    auxiliares: [
      ["capacidad_hidraulica", (t, e) => e.participacion_hidraulica * e.capacidad_instalada],
      ["capacidad_termica", (t, e) => (1 - e.participacion_hidraulica) * e.capacidad_instalada],
      ["capacidad_embalse", (t, e) => e.regulacion_embalse * e.capacidad_hidraulica],
      ["nivel_embalse", (t, e) => e.energia_embalsada / Math.max(e.capacidad_embalse, 1e-9)],
      ["factor_hidrologico", (t, e) => hidrologia(t)],
      ["aportes_medios", (t, e) => e.factor_aportes * e.gwh_por_mw_anio * e.capacidad_hidraulica],
      ["generacion_hidraulica_maxima", (t, e) => e.gwh_por_mw_anio * e.capacidad_hidraulica],
      ["generacion_termica_maxima", (t, e) => e.disponibilidad_termica * e.gwh_por_mw_anio * e.capacidad_termica],
      ["turbinamiento_regla", (t, e) => e.demanda * e.participacion_hidraulica_referencia
        * Math.max(e.nivel_embalse, 0) / e.nivel_referencia],
      ["margen_energia", (t, e) => (e.aportes_medios * e.factor_hidrologico + e.generacion_termica_maxima
        - e.demanda) / e.demanda],
      ["precio_bolsa", (t, e) => e.precio_referencia * Math.exp(
        -e.sensibilidad_precio * (e.nivel_embalse - e.nivel_referencia)
        - e.sensibilidad_margen * (e.margen_energia - e.margen_energia_referencia))],
      ["demanda_pico", (t, e) => e.demanda / (e.gwh_por_mw_anio * e.factor_carga)],
      ["margen_reserva", (t, e) => (e.capacidad_instalada - e.demanda_pico) / e.demanda_pico],
      ["capacidad_referencia", (t, e) => e.capacidad_por_demanda * e.demanda],
      ["cartera_normal", (t, e) => e.retardo_constructor * (1 / e.vida_util + e.crecimiento_demanda_anual)
        * e.capacidad_referencia],
      ["multiplicador_inversion", (t, e) => {
        const cociente = (Math.max(e.precio_esperado, 0) / e.precio_referencia) ** e.elasticidad_inversion;
        const tope = e.respuesta_maxima_inversion;
        return tope * cociente / (tope - 1 + cociente);
      }],
    ],
    flujos: [
      ["aportes", (t, e) => e.aportes_medios * e.factor_hidrologico],
      ["turbinamiento", (t, e) => Math.min(e.generacion_hidraulica_maxima, e.demanda, e.turbinamiento_regla)],
      ["vertimiento", (t, e) => Math.max(0, e.aportes - e.turbinamiento) * Math.max(e.nivel_embalse, 0) ** 2],
      ["generacion_termica", (t, e) => Math.min(e.generacion_termica_maxima, Math.max(0, e.demanda - e.turbinamiento))],
      ["deficit", (t, e) => e.demanda - e.turbinamiento - e.generacion_termica],
      ["inicio_proyectos", (t, e) => Math.max(0, e.tasa_inversion_referencia * e.capacidad_referencia
        * e.multiplicador_inversion
        - e.peso_cartera * (e.proyectos_en_construccion - e.cartera_normal) / e.retardo_constructor)],
      ["puesta_en_servicio", (t, e) => e.proyectos_en_construccion / e.retardo_constructor],
      ["retiros", (t, e) => e.capacidad_instalada / e.vida_util],
      ["crecimiento_demanda", (t, e) => e.crecimiento_demanda_anual * e.demanda
        * (e.precio_bolsa / e.precio_referencia) ** (-e.elasticidad_demanda)],
      ["ajuste_expectativa", (t, e) => (e.precio_bolsa - e.precio_esperado) / e.tiempo_expectativas],
    ],
  };
}

export const PARAMETROS_MERCADO = {
  // Segmento firme: hereda el modelo de la semana 4 (año 0 ≈ 2015)
  capacidad_firme_inicial: 16400, proyectos_firme_iniciales: 3000, demanda_inicial: 66000, nivel_embalse_inicial: 0.65,
  precio_esperado_inicial: null, crecimiento_demanda: 0.03, elasticidad_demanda: 0, retardo_constructor_firme: 4,
  vida_util_firme: 30, participacion_hidraulica: 0.65, factor_aportes: 0.62, regulacion_embalse: 1.5,
  disponibilidad_termica: 0.85, participacion_hidraulica_referencia: 0.80, nivel_referencia: 0.65, factor_carga: 0.80,
  precio_referencia: 150, sensibilidad_precio: 3, sensibilidad_margen: 1, elasticidad_inversion: 3,
  tiempo_expectativas: 1, expectativa_logaritmica: true, respuesta_maxima_inversion: 10, peso_cartera: 0,
  // Hidrología: El Niño reduce los aportes (apagado por omisión)
  periodo_nino: 0, duracion_nino: 1.5, intensidad_nino: 0.35, fase_nino: 8, rampa_nino: 0.25, amplitud_estacional: 0,
  factor_hidrologico: null,
  // Energía firme del segmento firme (ENFICC estilizada)
  aportes_criticos: 0.45, duracion_critica: 2,
  // Segmento FNCER
  capacidad_fncer_inicial: 100, proyectos_fncer_iniciales: 50, retardo_constructor_fncer: 1.5, vida_util_fncer: 25,
  factor_planta_fncer: 0.24, firmeza_fncer: 0.5, participacion_referencia_fncer: 0.05, elasticidad_fncer: 2,
  costo_fncer_inicial: 125, fraccion_costo_local: 0.35, caida_costo_global: 0.15, piso_costo_global: 50,
  tasa_aprendizaje: 0.10, canibalizacion: 2.5, limite_vertimiento: 0.25,
  // Cargo por Confiabilidad, subasta FNCER, impuesto
  prima_cxc: 0, inicio_cargo: 0, duracion_cargo: null, precio_escasez: 400, meta_subasta_firme: 0, tiempo_ajuste_subasta: 2,
  banda_curva_demanda: 0.04, subasta_fncer: 0, inicio_subasta: 0, duracion_subasta: null, duracion_contratos: 20,
  impuesto_carbono: 0,
  // Consulta: congestión, abandono y confianza (semana 6)
  congestion_social: 0, umbral_espera: 5, tiempo_abandono: 2, ancho_abandono: 1,
  usar_confianza: false, confianza_inicial: 0.6, confianza_referencia: null, plazo_tolerado: 4, tiempo_erosion: 1,
  sensibilidad_incumplimiento: 5, tiempo_recuperacion: 4, transferencias_comunidades: 0, transferencias_referencia: 0.02,
  fraccion_institucional: 0.5,
};

const rampaCoseno = (x, ancho) => (x <= 0 ? 0 : x >= ancho ? 1 : 0.5 * (1 - Math.cos(Math.PI * x / ancho)));

/** Intensidad relativa de El Niño en t (0 a 1), con bordes de coseno (réplica de mise_sd.modelos.pulso_nino). */
export function pulsoNino(t, periodo, duracion, fase, rampa) {
  if (periodo <= 0 || duracion <= 0) return 0;
  const inicio = fase - rampa / 2;
  if (t < inicio) return 0;
  const desfase = (t - inicio) % periodo;
  if (rampa <= 0) return desfase < duracion ? 1 : 0;
  return rampaCoseno(desfase, rampa) * rampaCoseno(duracion + rampa - desfase, rampa);
}

/** ENFICC estilizada del segmento firme [GWh/año por MW] (réplica de mise_sd.modelos.energia_firme_por_mw). */
export const energiaFirmePorMw = ({participacion_hidraulica = 0.65, factor_aportes = 0.62, regulacion_embalse = 1.5,
  disponibilidad_termica = 0.85, aportes_criticos = 0.45, duracion_critica = 2} = {}) =>
  disponibilidad_termica * GWH_POR_MW_ANIO * (1 - participacion_hidraulica)
  + aportes_criticos * factor_aportes * GWH_POR_MW_ANIO * participacion_hidraulica
  + regulacion_embalse * participacion_hidraulica / duracion_critica;

/** Multiplicador M r^ε / (M − 1 + r^ε) (réplica de mise_sd.modelos._respuesta_saturada). */
const respuestaSaturada = (cociente, elasticidad, tope) => {
  const potencia = Math.max(cociente, 0) ** elasticidad;
  return tope * potencia / (tope - 1 + potencia);
};

/**
 * Modelo de la semana 5: el de la semana 4 con FNCER, Cargo por Confiabilidad, subastas, impuesto y consulta
 * (versión 2; réplica de mise_sd.modelos.mercado_con_politicas). Mismos nombres y ecuaciones que en Python.
 */
export function mercadoConPoliticas(parametros = {}) {
  const p = {...PARAMETROS_MERCADO, ...parametros};
  const h = p.participacion_hidraulica, rRef = p.participacion_hidraulica_referencia, c = GWH_POR_MW_ANIO, g = p.crecimiento_demanda;
  const hidrologia = p.factor_hidrologico ?? ((t) =>
    (1 - p.intensidad_nino * pulsoNino(t, p.periodo_nino, p.duracion_nino, p.fase_nino, p.rampa_nino))
    * factorEstacionalAportes(t, p.amplitud_estacional));
  const ajuste = (stock, senal) => (t, e) => (e.expectativa_logaritmica > 0
    ? e[stock] * Math.log(Math.max(e[senal], 1e-9) / e[stock]) / e.tiempo_expectativas
    : (e[senal] - e[stock]) / e.tiempo_expectativas);
  return {
    nombre: "mercado_con_politicas",
    constantes: {
      gwh_por_mw_anio: c, crecimiento_demanda_anual: g, elasticidad_demanda: p.elasticidad_demanda,
      retardo_constructor: p.retardo_constructor_firme, vida_util: p.vida_util_firme, participacion_hidraulica: h,
      factor_aportes: p.factor_aportes, regulacion_embalse: p.regulacion_embalse, disponibilidad_termica: p.disponibilidad_termica,
      participacion_hidraulica_referencia: rRef, nivel_referencia: p.nivel_referencia, factor_carga: p.factor_carga,
      precio_referencia: p.precio_referencia, sensibilidad_precio: p.sensibilidad_precio, sensibilidad_margen: p.sensibilidad_margen,
      precio_escasez: p.precio_escasez, elasticidad_inversion: p.elasticidad_inversion, tiempo_expectativas: p.tiempo_expectativas,
      expectativa_logaritmica: p.expectativa_logaritmica ? 1 : 0, respuesta_maxima_inversion: p.respuesta_maxima_inversion,
      peso_cartera: p.peso_cartera, capacidad_por_demanda: rRef / (c * p.factor_aportes * h),
      margen_energia_referencia: margenEnergiaReferencia(p),
      tasa_inversion_referencia: (1 / p.vida_util_firme + g) * (1 + g * p.retardo_constructor_firme),
      periodo_nino: p.periodo_nino, duracion_nino: p.duracion_nino, intensidad_nino: p.intensidad_nino,
      fase_nino: p.fase_nino, rampa_nino: p.rampa_nino,
      energia_firme_por_mw: energiaFirmePorMw(p),
      retardo_fncer: p.retardo_constructor_fncer, vida_fncer: p.vida_util_fncer, factor_planta_fncer: p.factor_planta_fncer,
      firmeza_fncer: p.firmeza_fncer, participacion_referencia_fncer: p.participacion_referencia_fncer,
      elasticidad_fncer: p.elasticidad_fncer,
      tasa_inversion_fncer: (1 / p.vida_util_fncer + g) * (1 + g * p.retardo_constructor_fncer),
      canibalizacion: p.canibalizacion, limite_vertimiento: p.limite_vertimiento,
      costo_global_inicial: p.costo_fncer_inicial * (1 - p.fraccion_costo_local),
      costo_local_inicial: p.costo_fncer_inicial * p.fraccion_costo_local,
      caida_costo_global: p.caida_costo_global, piso_costo_global: p.piso_costo_global,
      exponente_wright: Math.log2(1 / (1 - p.tasa_aprendizaje)), fncer_acumulada_inicial: Math.max(p.capacidad_fncer_inicial, 1),
      prima_cxc: p.prima_cxc, inicio_cargo: p.inicio_cargo,
      fin_cargo: p.duracion_cargo === null ? Infinity : p.inicio_cargo + p.duracion_cargo,
      meta_subasta_firme: p.meta_subasta_firme, tiempo_ajuste_subasta: p.tiempo_ajuste_subasta,
      banda_curva_demanda: p.banda_curva_demanda, subasta_fncer: p.subasta_fncer, inicio_subasta: p.inicio_subasta,
      fin_subasta: p.duracion_subasta === null ? Infinity : p.inicio_subasta + p.duracion_subasta,
      duracion_contratos: p.duracion_contratos, impuesto_carbono: p.impuesto_carbono,
      congestion_social: p.congestion_social, umbral_espera: p.umbral_espera, tiempo_abandono: p.tiempo_abandono,
      ancho_abandono: p.ancho_abandono, usar_confianza: p.usar_confianza ? 1 : 0,
      confianza_referencia: p.confianza_referencia ?? p.confianza_inicial, plazo_tolerado: p.plazo_tolerado,
      tiempo_erosion: p.tiempo_erosion, sensibilidad_incumplimiento: p.sensibilidad_incumplimiento,
      tiempo_recuperacion: p.tiempo_recuperacion, transferencias_comunidades: p.transferencias_comunidades,
      transferencias_referencia: p.transferencias_referencia, fraccion_institucional: p.fraccion_institucional,
    },
    stocks: [
      {nombre: "capacidad_firme", inicial: p.capacidad_firme_inicial, entradas: ["puesta_firme"], salidas: ["retiros_firme"]},
      {nombre: "proyectos_firme", inicial: p.proyectos_firme_iniciales, entradas: ["inicios_firme"], salidas: ["puesta_firme"]},
      {nombre: "demanda", inicial: p.demanda_inicial, entradas: ["crecimiento_demanda"], salidas: []},
      {nombre: "energia_embalsada", inicial: p.nivel_embalse_inicial * p.regulacion_embalse * h * p.capacidad_firme_inicial,
        entradas: ["aportes"], salidas: ["turbinamiento", "vertimiento"]},
      {nombre: "precio_esperado", inicial: p.precio_esperado_inicial ?? p.precio_referencia, entradas: ["ajuste_precio_esperado"], salidas: []},
      {nombre: "capacidad_fncer", inicial: p.capacidad_fncer_inicial, entradas: ["puesta_fncer"], salidas: ["retiros_fncer"]},
      {nombre: "proyectos_fncer", inicial: p.proyectos_fncer_iniciales, entradas: ["inicios_fncer"], salidas: ["puesta_fncer", "abandono_fncer"]},
      {nombre: "fncer_acumulada", inicial: Math.max(p.capacidad_fncer_inicial, 1), entradas: ["puesta_fncer_acumulada"], salidas: []},
      {nombre: "ingreso_esperado_fncer", inicial: p.precio_referencia, entradas: ["ajuste_ingreso_fncer"], salidas: []},
      {nombre: "proyectos_subastados", inicial: 0, entradas: ["adjudicacion_fncer"], salidas: ["puesta_subastada", "abandono_subastado"]},
      {nombre: "valor_cartera_subastada", inicial: 0, entradas: ["valor_adjudicado"], salidas: ["valor_puesto", "valor_abandonado"]},
      {nombre: "contratos_fncer", inicial: 0, entradas: ["puesta_subastada"], salidas: ["vencimiento_contratos"]},
      {nombre: "valor_contratos", inicial: 0, entradas: ["valor_puesto"], salidas: ["valor_vencido"]},
      {nombre: "confianza", inicial: p.confianza_inicial, entradas: ["recuperacion_confianza"], salidas: ["erosion_confianza"]},
    ],
    auxiliares: [
      // Parque firme y embalse (semana 4)
      ["capacidad_hidraulica", (t, e) => e.participacion_hidraulica * e.capacidad_firme],
      ["capacidad_termica", (t, e) => (1 - e.participacion_hidraulica) * e.capacidad_firme],
      ["capacidad_embalse", (t, e) => e.regulacion_embalse * e.capacidad_hidraulica],
      ["nivel_embalse", (t, e) => e.energia_embalsada / Math.max(e.capacidad_embalse, 1e-9)],
      ["factor_hidrologico", (t, e) => hidrologia(t)],
      ["factor_nino", (t, e) => pulsoNino(t, e.periodo_nino, e.duracion_nino, e.fase_nino, e.rampa_nino)],
      ["aportes_medios", (t, e) => e.factor_aportes * e.gwh_por_mw_anio * e.capacidad_hidraulica],
      ["generacion_hidraulica_maxima", (t, e) => e.gwh_por_mw_anio * e.capacidad_hidraulica],
      ["generacion_termica_maxima", (t, e) => e.disponibilidad_termica * e.gwh_por_mw_anio * e.capacidad_termica],
      // FNCER: energía, vertimiento y demanda residual
      ["energia_fncer_nominal", (t, e) => e.gwh_por_mw_anio * e.factor_planta_fncer * e.capacidad_fncer],
      ["participacion_energia_fncer", (t, e) => e.energia_fncer_nominal / e.demanda],
      ["participacion_aprovechada_fncer", (t, e) => e.participacion_energia_fncer
        * (1 + (e.participacion_energia_fncer / e.limite_vertimiento) ** 4) ** -0.25],
      ["fraccion_aprovechada", (t, e) => (e.participacion_energia_fncer > 1e-12
        ? e.participacion_aprovechada_fncer / e.participacion_energia_fncer : 1)],
      ["generacion_fncer", (t, e) => e.participacion_aprovechada_fncer * e.demanda],
      ["vertimiento_fncer", (t, e) => e.energia_fncer_nominal - e.generacion_fncer],
      ["demanda_residual", (t, e) => Math.max(0, e.demanda - e.generacion_fncer)],
      ["turbinamiento_regla", (t, e) => e.demanda_residual * e.participacion_hidraulica_referencia
        * Math.max(e.nivel_embalse, 0) / e.nivel_referencia],
      // Margen de energía, despacho y precio
      ["margen_energia", (t, e) => (e.aportes_medios * e.factor_hidrologico + e.generacion_termica_maxima + e.generacion_fncer
        - e.demanda) / e.demanda],
      ["turbinamiento_despacho", (t, e) => Math.min(e.generacion_hidraulica_maxima, e.demanda_residual, e.turbinamiento_regla)],
      ["generacion_termica_despacho", (t, e) => Math.min(e.generacion_termica_maxima,
        Math.max(0, e.demanda_residual - e.turbinamiento_despacho))],
      ["utilizacion_termica", (t, e) => (e.generacion_termica_maxima > 1e-9
        ? Math.min(1, e.generacion_termica_despacho / e.generacion_termica_maxima) : 0)],
      ["traslado_carbono", (t, e) => e.impuesto_carbono * e.utilizacion_termica],
      ["precio_bolsa", (t, e) => e.precio_referencia * Math.exp(
        -e.sensibilidad_precio * (e.nivel_embalse - e.nivel_referencia)
        - e.sensibilidad_margen * (e.margen_energia - e.margen_energia_referencia)) + e.traslado_carbono],
      ["demanda_pico", (t, e) => e.demanda / (e.gwh_por_mw_anio * e.factor_carga)],
      ["margen_reserva", (t, e) => (e.capacidad_firme + e.capacidad_fncer - e.demanda_pico) / e.demanda_pico],
      ["penetracion_fncer", (t, e) => e.capacidad_fncer / e.demanda_pico],
      // Energía firme (ENFICC) y Cargo por Confiabilidad
      ["energia_firme", (t, e) => e.energia_firme_por_mw * e.capacidad_firme],
      ["energia_firme_fncer", (t, e) => e.firmeza_fncer * e.energia_fncer_nominal],
      ["margen_firme", (t, e) => (e.energia_firme + e.energia_firme_fncer - e.demanda) / e.demanda],
      ["prima_vigente", (t, e) => (e.inicio_cargo <= t && t < e.fin_cargo ? e.prima_cxc : 0)],
      ["cxc_activo", (t, e) => (e.prima_vigente > 0 || e.meta_subasta_firme > 0 ? 1 : 0)],
      ["margen_proyectado", (t, e) => e.margen_firme + e.energia_firme_por_mw * (e.proyectos_firme
        - e.retardo_constructor * (1 / e.vida_util + e.crecimiento_demanda_anual) * e.capacidad_firme) / e.demanda],
      ["factor_curva_demanda", (t, e) => Math.min(2, Math.max(0, 1 + (e.meta_subasta_firme - e.margen_proyectado)
        / e.banda_curva_demanda))],
      ["cargo_confiabilidad", (t, e) => (e.meta_subasta_firme > 0
        ? Math.max(e.prima_vigente, Math.max(0, e.precio_referencia - e.precio_esperado) * e.factor_curva_demanda)
        : e.prima_vigente)],
      ["obligaciones_energia_firme", (t, e) => (e.cxc_activo > 0
        ? Math.min(e.energia_firme, e.demanda * (1 + e.meta_subasta_firme)) : 0)],
      ["fraccion_comprometida", (t, e) => (e.energia_firme > 1e-9
        ? Math.min(1, e.obligaciones_energia_firme / e.energia_firme) : 0)],
      ["cobertura_demanda", (t, e) => Math.min(1, e.obligaciones_energia_firme / e.demanda)],
      ["renta_escasez", (t, e) => Math.max(0, e.precio_bolsa - e.precio_escasez)],
      ["participacion_termica_generada", (t, e) => (e.turbinamiento_despacho + e.generacion_termica_despacho > 1e-9
        ? e.generacion_termica_despacho / (e.turbinamiento_despacho + e.generacion_termica_despacho)
        : 1 - e.participacion_hidraulica)],
      ["ingreso_energia_firme", (t, e) => e.precio_bolsa - e.fraccion_comprometida * e.renta_escasez
        - e.impuesto_carbono * e.participacion_termica_generada],
      ["pago_opcion", (t, e) => e.cobertura_demanda * e.renta_escasez],
      ["pago_cargo", (t, e) => e.cargo_confiabilidad * e.obligaciones_energia_firme / e.demanda],
      ["ingreso_firme", (t, e) => e.precio_esperado + e.cargo_confiabilidad * e.fraccion_comprometida],
      // Inversión firme (regla de la semana 4)
      ["capacidad_referencia", (t, e) => e.capacidad_por_demanda * e.demanda_residual],
      ["cartera_normal", (t, e) => e.retardo_constructor * (1 / e.vida_util + e.crecimiento_demanda_anual) * e.capacidad_referencia],
      ["multiplicador_inversion", (t, e) => respuestaSaturada(e.ingreso_firme / e.precio_referencia, e.elasticidad_inversion,
        e.respuesta_maxima_inversion)],
      ["inicios_firme_mercado", (t, e) => Math.max(0, e.tasa_inversion_referencia * e.capacidad_referencia
        * e.multiplicador_inversion - e.peso_cartera * (e.proyectos_firme - e.cartera_normal) / e.retardo_constructor)],
      ["subasta_firme", (t, e) => (e.meta_subasta_firme > 0
        ? Math.max(0, e.meta_subasta_firme - e.margen_proyectado) * e.demanda / (e.energia_firme_por_mw * e.tiempo_ajuste_subasta)
        : 0)],
      // FNCER: ingreso, costo, congestión e inversión
      ["precio_capturado_fncer", (t, e) => e.precio_bolsa * Math.exp(-e.canibalizacion * e.participacion_aprovechada_fncer)],
      ["ingreso_fncer", (t, e) => e.precio_capturado_fncer * e.fraccion_aprovechada * (1 - e.transferencias_comunidades)],
      ["costo_global_fncer", (t, e) => e.piso_costo_global
        + (e.costo_global_inicial - e.piso_costo_global) * Math.exp(-e.caida_costo_global * t)],
      ["costo_local_fncer", (t, e) => e.costo_local_inicial * (e.fncer_acumulada / e.fncer_acumulada_inicial) ** (-e.exponente_wright)],
      ["costo_fncer", (t, e) => e.costo_global_fncer + e.costo_local_fncer],
      ["factor_desconfianza", (t, e) => (e.usar_confianza > 0
        ? e.fraccion_institucional + (1 - e.fraccion_institucional) * (1 - e.confianza) / (1 - e.confianza_referencia) : 1)],
      ["retardo_fncer_efectivo", (t, e) => e.retardo_fncer + e.congestion_social * e.factor_desconfianza * e.proyectos_fncer / 1000],
      ["fraccion_abandono", (t, e) => {
        const exceso = e.retardo_fncer_efectivo - e.umbral_espera;
        return exceso <= 0 ? 0 : exceso * exceso / (exceso * exceso + e.ancho_abandono ** 2);
      }],
      ["tasa_abandono", (t, e) => e.fraccion_abandono * e.factor_desconfianza / e.tiempo_abandono],
      ["espera_excedente", (t, e) => Math.max(0, e.retardo_fncer_efectivo - e.plazo_tolerado) / e.plazo_tolerado],
      ["incumplimiento", (t, e) => e.sensibilidad_incumplimiento * e.tasa_abandono],
      ["confianza_indicada", (t, e) => Math.min(1, e.confianza_referencia * (1 + e.transferencias_comunidades / e.transferencias_referencia)
        / (1 + e.espera_excedente + e.incumplimiento))],
      ["capacidad_referencia_fncer", (t, e) => e.participacion_referencia_fncer * e.demanda / (e.gwh_por_mw_anio * e.factor_planta_fncer)],
      ["multiplicador_fncer", (t, e) => respuestaSaturada(e.ingreso_esperado_fncer / e.costo_fncer, e.elasticidad_fncer,
        e.respuesta_maxima_inversion)],
      ["inicios_fncer_mercado", (t, e) => e.tasa_inversion_fncer * e.capacidad_referencia_fncer * e.multiplicador_fncer
        * e.retardo_fncer / e.retardo_fncer_efectivo],
      ["subasta_vigente", (t, e) => (e.inicio_subasta <= t && t < e.fin_subasta ? e.subasta_fncer : 0)],
      // Contratos por diferencias y lo que paga la demanda
      ["precio_contratos", (t, e) => (e.contratos_fncer > 1e-9 ? e.valor_contratos / e.contratos_fncer : 0)],
      ["costo_contratos", (t, e) => (e.precio_contratos - e.precio_capturado_fncer) * e.gwh_por_mw_anio * e.factor_planta_fncer
        * e.contratos_fncer * e.fraccion_aprovechada / e.demanda],
      ["precio_demanda", (t, e) => e.precio_bolsa - e.pago_opcion + e.pago_cargo + e.costo_contratos],
    ],
    flujos: [
      ["aportes", (t, e) => e.aportes_medios * e.factor_hidrologico],
      ["turbinamiento", (t, e) => e.turbinamiento_despacho],
      ["vertimiento", (t, e) => Math.max(0, e.aportes - e.turbinamiento) * Math.max(e.nivel_embalse, 0) ** 2],
      ["generacion_termica", (t, e) => e.generacion_termica_despacho],
      ["deficit", (t, e) => e.demanda_residual - e.turbinamiento - e.generacion_termica],
      ["inicios_firme", (t, e) => e.inicios_firme_mercado + e.subasta_firme],
      ["puesta_firme", (t, e) => e.proyectos_firme / e.retardo_constructor],
      ["retiros_firme", (t, e) => e.capacidad_firme / e.vida_util],
      ["crecimiento_demanda", (t, e) => e.crecimiento_demanda_anual * e.demanda
        * (e.precio_bolsa / e.precio_referencia) ** (-e.elasticidad_demanda)],
      ["ajuste_precio_esperado", ajuste("precio_esperado", "ingreso_energia_firme")],
      ["inicios_fncer", (t, e) => e.inicios_fncer_mercado + e.subasta_vigente],
      ["puesta_fncer", (t, e) => e.proyectos_fncer / e.retardo_fncer_efectivo],
      ["abandono_fncer", (t, e) => e.proyectos_fncer * e.tasa_abandono],
      ["puesta_fncer_acumulada", (t, e) => e.puesta_fncer],
      ["retiros_fncer", (t, e) => e.capacidad_fncer / e.vida_fncer],
      ["ajuste_ingreso_fncer", ajuste("ingreso_esperado_fncer", "ingreso_fncer")],
      ["adjudicacion_fncer", (t, e) => e.subasta_vigente],
      ["puesta_subastada", (t, e) => e.proyectos_subastados / e.retardo_fncer_efectivo],
      ["abandono_subastado", (t, e) => e.proyectos_subastados * e.tasa_abandono],
      ["valor_adjudicado", (t, e) => e.subasta_vigente * e.costo_fncer],
      ["valor_puesto", (t, e) => e.valor_cartera_subastada / e.retardo_fncer_efectivo],
      ["valor_abandonado", (t, e) => e.valor_cartera_subastada * e.tasa_abandono],
      ["vencimiento_contratos", (t, e) => e.contratos_fncer / e.duracion_contratos],
      ["valor_vencido", (t, e) => e.valor_contratos / e.duracion_contratos],
      ["erosion_confianza", (t, e) => e.usar_confianza * Math.max(0, e.confianza - e.confianza_indicada) / e.tiempo_erosion],
      ["recuperacion_confianza", (t, e) => e.usar_confianza * Math.max(0, e.confianza_indicada - e.confianza) / e.tiempo_recuperacion],
    ],
  };
}

/**
 * Mundos, estrategias y métrica del Laboratorio 4 (réplica de notas/semana5/figuras/escenarios_lab4.py).
 * ESCENARIOS_LAB4 son los cuatro mundos de la matriz 2×2; MUNDOS_LAB4 agrega la sequía de diseño (la hidrología
 * crítica de la ENFICC), que es la tabla principal de cinco mundos.
 */
export const ESCENARIOS_LAB4 = {
  "Viento a favor": {caida_costo_global: 0.20, crecimiento_demanda: 0.02, periodo_nino: 7, intensidad_nino: 0.30},
  "Contrarreloj": {caida_costo_global: 0.20, crecimiento_demanda: 0.045, periodo_nino: 4, intensidad_nino: 0.40},
  "Siesta": {caida_costo_global: 0.08, crecimiento_demanda: 0.02, periodo_nino: 7, intensidad_nino: 0.30},
  "Tormenta": {caida_costo_global: 0.08, crecimiento_demanda: 0.045, periodo_nino: 4, intensidad_nino: 0.40},
};
export const ESTRATEGIAS_LAB4 = {
  "mercado solo": {}, "seguro CxC": {prima_cxc: 35}, "CxC por subasta": {meta_subasta_firme: 0.05},
  "impulso FNCER": {subasta_fncer: 300}, "paquete": {meta_subasta_firme: 0.05, subasta_fncer: 150},
  "cargo 15 + FNCER 300": {prima_cxc: 15, subasta_fncer: 300},
};
/** Sequía de diseño: hidrología crítica de la ENFICC (aportes al 45 % durante 2 años) en el año 20, demanda de 4,5 %/año. */
export const ESTRES_LAB4 = {caida_costo_global: 0.08, crecimiento_demanda: 0.045, periodo_nino: 100, fase_nino: 20,
  duracion_nino: 2, intensidad_nino: 0.55};
export const SEQUIA_DE_DISENO = "Sequía de diseño";
/** Los cinco mundos de la tabla principal: la matriz 2×2 más la sequía de diseño. */
export const MUNDOS_LAB4 = {...ESCENARIOS_LAB4, [SEQUIA_DE_DISENO]: ESTRES_LAB4};
export const T_FINAL_LAB4 = 40;
export const PASO_LAB4 = 0.05;
/** Costo de racionamiento [COP/kWh del modelo]: primer escalón de la UPME reescalado con el precio de escasez [POR VERIFICAR]. */
export const COSTO_RACIONAMIENTO = 2100;

/** Media temporal por la regla del trapecio (réplica de escenarios_lab4.media_temporal). */
export const mediaTemporal = (tiempo, serie) => area(tiempo, serie) / (tiempo[tiempo.length - 1] - tiempo[0]);

/**
 * Costo medio para la demanda [COP/kWh] de una corrida (réplica de escenarios_lab4.costo_para_demanda):
 * media temporal por trapecio de precio_demanda + costo de racionamiento · deficit / demanda. El cargo, la
 * opción, los contratos y el déficit ya vienen del modelo; las claves de estrategia que se pasen se ignoran.
 */
export function costoParaDemanda(resultado, {costo_racionamiento = COSTO_RACIONAMIENTO} = {}) {
  const v = resultado.variables;
  const serie = resultado.tiempo.map((_, k) => v.precio_demanda[k] + costo_racionamiento * v.deficit[k] / v.demanda[k]);
  return mediaTemporal(resultado.tiempo, serie);
}

/** Parámetros de una celda: un mundo de MUNDOS_LAB4 (o «estrés», alias de la sequía de diseño) y una estrategia. */
export const parametrosLab4 = (escenario, estrategia) =>
  ({...(escenario === "estrés" ? ESTRES_LAB4 : MUNDOS_LAB4[escenario]), ...ESTRATEGIAS_LAB4[estrategia]});

/** Corrida de una celda del Laboratorio 4 con la malla del texto (RK4, paso 0,05 años, 40 años). */
export const correrLab4 = (escenario, estrategia) =>
  simular(mercadoConPoliticas(parametrosLab4(escenario, estrategia)), {tFinal: T_FINAL_LAB4, paso: PASO_LAB4});

/** Máxima fracción de la demanda racionada en una corrida (réplica de escenarios_lab4.deficit_maximo). */
export const deficitMaximo = (resultado) =>
  Math.max(...resultado.variables.deficit.map((d, k) => d / resultado.variables.demanda[k]));

/**
 * Tabla del Laboratorio 4: corre cada celda una vez y devuelve las corridas, la matriz estrategias × mundos del
 * costo para la demanda y el déficit máximo de cada celda. Por omisión, los cinco mundos y las seis estrategias.
 */
export function tablaLab4({mundos = Object.keys(MUNDOS_LAB4), estrategias = Object.keys(ESTRATEGIAS_LAB4),
  costo_racionamiento = COSTO_RACIONAMIENTO} = {}) {
  const corridas = estrategias.map((e) => mundos.map((m) => correrLab4(m, e)));
  return {mundos, estrategias, corridas,
    costos: corridas.map((fila) => fila.map((r) => costoParaDemanda(r, {costo_racionamiento}))),
    deficit: corridas.map((fila) => fila.map(deficitMaximo))};
}

/** Reserva con meta del operador y presión comercial (réplica de mise_sd.modelos.reserva_con_dos_metas). */
export function reservaConDosMetas({reserva_inicial = 5000, meta_operador = 9000, tiempo_ajuste_operador = 3,
  meta_comercial = 7000, tiempo_ajuste_comercial = null} = {}) {
  return {
    nombre: "reserva_con_dos_metas",
    constantes: {meta_operador, tiempo_ajuste_operador, meta_comercial, tiempo_ajuste_comercial: tiempo_ajuste_comercial || 0},
    stocks: [{nombre: "reserva", inicial: reserva_inicial, entradas: ["recuperacion"], salidas: ["presion_comercial"]}],
    auxiliares: [],
    flujos: [
      ["recuperacion", (t, e) => (e.meta_operador - e.reserva) / e.tiempo_ajuste_operador],
      ["presion_comercial", tiempo_ajuste_comercial
        ? (t, e) => Math.max(0, e.reserva - e.meta_comercial) / e.tiempo_ajuste_comercial : () => 0],
    ],
  };
}

/** Cronograma de un proyecto con consulta previa, en meses (réplica de mise_sd.modelos.cronograma_consulta). */
export function cronogramaConsulta({certificacion = 6, preconsulta = 9, talleres = 18, protocolizacion = 5,
  licencia_ambiental = 24, cierre_financiero = 8, construccion = 24, reabrir = false} = {}) {
  const etapas = [];
  let t = 0;
  for (const [nombre, d] of [["certificación", certificacion], ["preconsulta", preconsulta]]) { etapas.push([nombre, t, t + d]); t += d; }
  const inicioTalleres = t;
  etapas.push(["talleres y acuerdos", t, t + talleres]); t += talleres;
  etapas.push(["protocolización", t, t + protocolizacion]); t += protocolizacion;
  if (reabrir) {
    for (const [nombre, d] of [["preconsulta repetida", preconsulta], ["talleres repetidos", talleres], ["protocolización repetida", protocolizacion]]) {
      etapas.push([nombre, t, t + d]); t += d;
    }
  }
  const finLicencia = Math.max(inicioTalleres + licencia_ambiental, t);
  etapas.push(["licencia ambiental", inicioTalleres, finLicencia]);
  const inicioCierre = Math.max(finLicencia, t);
  etapas.push(["cierre financiero", inicioCierre, inicioCierre + cierre_financiero]);
  const inicioObra = inicioCierre + cierre_financiero;
  etapas.push(["construcción", inicioObra, inicioObra + construccion]);
  return {etapas, primer_kwh: inicioObra + construccion};
}

/** Arrepentimiento, maximin y minimax regret de una matriz estrategias × escenarios (réplica de mise_sd.modelos.criterios_robustez). */
export function criteriosRobustez(matriz) {
  const minimos = matriz[0].map((_, j) => Math.min(...matriz.map((fila) => fila[j])));
  const arrepentimiento = matriz.map((fila) => fila.map((c, j) => c - minimos[j]));
  const peorCaso = matriz.map((fila) => Math.max(...fila));
  const arrepentimientoMaximo = arrepentimiento.map((fila) => Math.max(...fila));
  return {arrepentimiento, peorCaso, arrepentimientoMaximo,
    maximin: peorCaso.indexOf(Math.min(...peorCaso)), minimaxRegret: arrepentimientoMaximo.indexOf(Math.min(...arrepentimientoMaximo))};
}

/** VPN esperado según la probabilidad anual de El Niño (réplica de mise_sd.modelos.vpn_con_nino). */
export function vpnConNino(probabilidad_nino, {inversion, margen_normal, margen_nino, tasa_descuento = 0.10, anios = 20}) {
  const factor = (1 - (1 + tasa_descuento) ** (-anios)) / tasa_descuento;
  return -inversion + factor * (probabilidad_nino * margen_nino + (1 - probabilidad_nino) * margen_normal);
}

/** Costo futuro con curva de Wright y despliegue exponencial (réplica de mise_sd.modelos.costo_wright). */
/** Equilibrio de usuario en la red de Braess (réplica de equilibrio_braess). */
export function equilibrioBraess({conductores = 4000, capacidad = 100, tiempo_fijo = 45, tiempo_conector = null} = {}) {
  const n = conductores, k = capacidad, b = tiempo_fijo, sin = n / (2 * k) + b;
  if (tiempo_conector === null) return {ruta_superior: n / 2, ruta_inferior: n / 2, ruta_conector: 0, tiempo: sin, tiempo_sin_conector: sin};
  const c = tiempo_conector;
  let x, x3, tiempo;
  if (c <= b - n / k) { x = 0; x3 = n; tiempo = 2 * n / k + c; }
  else if (c <= b - n / (2 * k)) { x = n - k * (b - c); x3 = 2 * k * (b - c) - n; tiempo = 2 * b - c; }
  else { x = n / 2; x3 = 0; tiempo = sin; }
  return {ruta_superior: x, ruta_inferior: x, ruta_conector: x3, tiempo, tiempo_sin_conector: sin};
}

/** Generador congruencial lineal, idéntico a GeneradorCongruencial de mise_sd.modelos. */
export function generadorCongruencial(semilla = 1) {
  let estado = (Math.floor(semilla) % 4294967296) || 1;
  return () => { estado = Number((BigInt(estado) * 1664525n + 1013904223n) % 4294967296n); return estado / 4294967296; };
}

/** Actividades del hogar sintético (réplica de ACTIVIDADES_HOGAR). */
export const ACTIVIDADES_HOGAR = [[3.0, 8, 6.0, 1.0, 0.5], [1.2, 30, 6.3, 0.8, 0.6], [1.2, 40, 12.0, 0.8, 0.5],
  [1.2, 45, 19.0, 1.0, 0.7], [0.35, 240, 18.8, 0.7, 0.95], [0.2, 180, 19.8, 1.2, 0.8], [1.0, 60, 10.0, 3.0, 0.3]];

/** Curva de carga agregada de hogares sintéticos (réplica de curva_carga_hogares). */
export function curvaCargaHogares({hogares = 100, semilla = 2016} = {}) {
  const azar = generadorCongruencial(semilla), minutos = 1440;
  const sumaHoraria = Array(24).fill(0);
  let sumaPicos = 0;
  for (let i = 0; i < hogares; i++) {
    const carga = Array(minutos).fill(0.05);
    const fase = Math.floor(azar() * 50);
    for (let m = 0; m < minutos; m++) if ((m + fase) % 50 < 20) carga[m] += 0.12;
    for (const [potencia, duracion, hora, desviacion, probabilidad] of ACTIVIDADES_HOGAR) {
      if (azar() > probabilidad) continue;
      let z = 0;
      for (let k = 0; k < 12; k++) z += azar();
      z -= 6;
      const inicio = Math.trunc(Math.min(Math.max((hora + desviacion * z) * 60, 0), minutos - 1));
      const largo = Math.max(5, Math.trunc(duracion * (0.5 + azar())));
      for (let m = inicio; m < Math.min(inicio + largo, minutos); m++) carga[m] += potencia;
    }
    const horaria = [];
    for (let h = 0; h < 24; h++) { let total = 0; for (let m = h * 60; m < h * 60 + 60; m++) total += carga[m]; horaria.push(total / 60); }
    sumaPicos += Math.max(...horaria);
    for (let h = 0; h < 24; h++) sumaHoraria[h] += horaria[h];
  }
  const perfil = sumaHoraria.map((v) => v / hogares);
  const pico_agregado = Math.max(...perfil), pico_individual_medio = sumaPicos / hogares;
  return {perfil, pico_agregado, pico_individual_medio, factor_coincidencia: pico_agregado / pico_individual_medio,
    hora_pico: perfil.indexOf(pico_agregado), consumo_mensual_kwh: perfil.reduce((a, b) => a + b, 0) * 30};
}

/** Urna de Pólya generalizada (réplica de urna_polya): participación de A tras cada adopción. */
export function urnaPolya({adoptantes = 2000, historias = 20, exponente = 1, base = [1, 1], semilla = 1989} = {}) {
  const azar = generadorCongruencial(semilla), salida = [];
  for (let h = 0; h < historias; h++) {
    let nA = base[0], nB = base[1];
    const fila = [nA / (nA + nB)];
    for (let paso = 1; paso <= adoptantes; paso++) {
      const pa = Math.pow(nA, exponente), pb = Math.pow(nB, exponente);
      if (azar() < pa / (pa + pb)) nA += 1; else nB += 1;
      fila.push(nA / (nA + nB));
    }
    salida.push(fila);
  }
  return salida;
}

/** Escalera de oferta en hidrología normal: [nombre, potencia GW, precio COP/kWh]. */
export const ESCALERA_NORMAL = [["Filo de agua y menores", 1.5, 40], ["Hidráulica ofertada a precio bajo", 8.5, 110],
  ["Carbón", 1.3, 190], ["Gas", 2.3, 260], ["Líquidos", 1.2, 480]];

/** Escalera de oferta durante El Niño, con agua a valor de escasez. */
export const ESCALERA_NINO = [["Filo de agua y menores", 0.9, 40], ["Hidráulica ofertada a precio bajo", 4.0, 180],
  ["Carbón", 1.3, 190], ["Gas", 2.3, 260], ["Líquidos", 1.2, 480], ["Agua a valor de escasez", 3.0, 1500]];

/** Despacho por orden de mérito y precio marginal (réplica de orden_merito). */
export function ordenMerito(bloques, demanda) {
  const ordenados = [...bloques].sort((a, b) => a[2] - b[2]);
  let restante = demanda, costo = 0, precio_marginal = 0, bloque_marginal = "";
  const despacho = [];
  for (const [nombre, potencia, precio] of ordenados) {
    const usado = Math.max(Math.min(potencia, restante), 0);
    if (usado > 0) { precio_marginal = precio; bloque_marginal = nombre; }
    despacho.push({nombre, potencia, usado, precio});
    costo += usado * precio;
    restante = Math.max(restante - usado, 0);
  }
  return {precio_marginal, bloque_marginal, despacho, no_servida: restante,
    capacidad_total: bloques.reduce((a, b) => a + b[1], 0), costo_total: costo};
}

/** VPN de una térmica de respaldo con y sin despacho forzado (réplica de vpn_termica_crisis). */
export function vpnTermicaCrisis({inversion = 70, capacidad_mw = 200, energia_cargo_gwh = 1300, precio_cargo_usd_mwh = 15,
  margen_energia_usd_mwh = 10, factor_planta_normal = 0.05, costos_fijos = 6, anios = 10, tasa_descuento = 0.10,
  dias_despacho_forzado = 0, factor_despacho_crisis = 0.85, brecha_costo_precio_usd_mwh = 50,
  anio_crisis = 2, compensacion = 0, anio_compensacion = 3} = {}) {
  const ingreso_cargo = energia_cargo_gwh * 1000 * precio_cargo_usd_mwh / 1e6;
  const margen_energia = capacidad_mw * 8760 * factor_planta_normal * margen_energia_usd_mwh / 1e6;
  const flujo_anual = ingreso_cargo + margen_energia - costos_fijos;
  const anualidad = (1 - Math.pow(1 + tasa_descuento, -anios)) / tasa_descuento;
  const vpn_base = -inversion + anualidad * flujo_anual;
  const energia_crisis_gwh = capacidad_mw * factor_despacho_crisis * 24 * dias_despacho_forzado / 1000;
  const perdida_crisis = energia_crisis_gwh * 1000 * brecha_costo_precio_usd_mwh / 1e6;
  const valor_presente_perdida = perdida_crisis / Math.pow(1 + tasa_descuento, anio_crisis);
  const valor_presente_compensacion = compensacion / Math.pow(1 + tasa_descuento, anio_compensacion);
  return {ingreso_cargo, margen_energia, flujo_anual, anualidad, vpn_base, energia_crisis_gwh, perdida_crisis,
    valor_presente_perdida, valor_presente_compensacion,
    vpn_con_crisis: vpn_base - valor_presente_perdida + valor_presente_compensacion};
}

export function costoWright(anios, tasa_aprendizaje, crecimiento_despliegue, costo_inicial = 100) {
  return costo_inicial * Math.exp(-crecimiento_despliegue * anios * Math.log2(1 / (1 - tasa_aprendizaje)));
}

/** Telaraña del ciclo del cerdo en tiempo discreto (réplica de mise_sd.modelos.telarana). */
export function telarana({rondas = 16, oferta_inicial = 80, sensibilidad_oferta = 0.4, pendiente_demanda = 2,
  precio_equilibrio = 100, oferta_equilibrio = 100} = {}) {
  const oferta = [oferta_inicial], precio = [];
  for (let ronda = 0; ronda < rondas; ronda++) {
    precio.push(Math.max(0, precio_equilibrio - pendiente_demanda * (oferta.at(-1) - oferta_equilibrio)));
    if (ronda < rondas - 1) oferta.push(Math.max(0, oferta_equilibrio + sensibilidad_oferta * (precio.at(-1) - precio_equilibrio)));
  }
  return {ronda: Array.from({length: rondas}, (_, k) => k), oferta, precio};
}

/**
 * Inventario que busca su meta a través de un retardo de entrega de orden n
 * (réplica de mise_sd.modelos.inventario_con_retardo).
 */
export function inventarioConRetardo({inventario_inicial = 60, meta = 120, consumo = 30, tiempo_ajuste = 1,
  retardo = 2, orden = 3, peso_transito = 0, pedidos_minimos = 0, tiempo_minimo_uso = 0.25} = {}) {
  if (!(tiempo_ajuste > 0) || !(retardo > 0)) throw new Error("El tiempo de ajuste y el retardo deben ser positivos.");
  const etapas = Array.from({length: orden}, (_, k) => `transito_${k + 1}`);
  const flujos = ["pedidos", ...Array.from({length: orden - 1}, (_, k) => `avance_${k + 1}`), "llegadas"];
  return {
    nombre: "inventario_con_retardo",
    constantes: {meta, consumo, tiempo_ajuste, peso_transito, transito_normal: consumo * retardo, tiempo_etapa: retardo / orden,
      tiempo_minimo_uso},
    stocks: [
      ...etapas.map((etapa, k) => ({nombre: etapa, inicial: consumo * retardo / orden, entradas: [flujos[k]], salidas: [flujos[k + 1]]})),
      {nombre: "inventario", inicial: inventario_inicial, entradas: ["llegadas"], salidas: ["uso"]},
    ],
    auxiliares: [["en_transito", (t, e) => etapas.reduce((a, etapa) => a + e[etapa], 0)]],
    flujos: [
      ["pedidos", (t, e) => {
        const bruto = e.consumo + (e.meta - e.inventario - e.peso_transito * (e.en_transito - e.transito_normal)) / e.tiempo_ajuste;
        return pedidos_minimos === null ? bruto : Math.max(pedidos_minimos, bruto);
      }],
      ...etapas.map((etapa, k) => [flujos[k + 1], (t, e) => e[etapa] / e.tiempo_etapa]),
      ["uso", (t, e) => Math.min(e.consumo, e.inventario / e.tiempo_minimo_uso)],
    ],
  };
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

/** La bañera de Sterman [L, min] (réplica de mise_sd.modelos.banera). El desagüe
 *  constante no saca agua que no hay: salida = min(caudal, nivel / tiempo mínimo de vaciado). */
export function banera({nivel_inicial = 80, caudal_grifo = 5, caudal_desague = 3, tau_desague = null,
  tiempo_vaciado_minimo = 0.25} = {}) {
  if (tau_desague !== null && !(tau_desague > 0)) throw new Error("tau_desague debe ser positivo (o null para un desagüe constante).");
  return {
    nombre: "banera",
    constantes: {caudal_grifo, caudal_desague, tau_desague: tau_desague || 0, tiempo_vaciado_minimo},
    stocks: [{nombre: "nivel", inicial: nivel_inicial, entradas: ["entrada"], salidas: ["salida"]}],
    auxiliares: [],
    flujos: [
      ["entrada", (t, e) => e.caudal_grifo],
      ["salida", tau_desague ? (t, e) => e.nivel / e.tau_desague
        : (t, e) => Math.min(e.caudal_desague, e.nivel / e.tiempo_vaciado_minimo)],
    ],
  };
}

/**
 * Cobertura de contratos con retardo de negociación [GWh, años]
 * (réplica de mise_sd.modelos.cobertura_contratos). Las compras, max(0, brecha)/T,
 * pasan por la negociación; los vencimientos, max(0, −brecha)/T, salen directo de
 * la cobertura. Ningún stock queda negativo.
 */
export function coberturaContratos({cobertura_inicial = 60, meta = 100, tiempo_ajuste = 0.5,
  retardo_negociacion = 0.5, etapas = 3} = {}) {
  if (!(tiempo_ajuste > 0)) throw new Error("El tiempo de ajuste debe ser positivo.");
  const conRetardo = retardo_negociacion > 0;
  const stocks = [{nombre: "cobertura", inicial: cobertura_inicial,
    entradas: [conRetardo ? "firma" : "compras"], salidas: ["vencimientos"]}];
  const flujos = [["compras", (t, e) => Math.max(0, e.brecha) / e.tiempo_ajuste],
    ["vencimientos", (t, e) => Math.max(0, -e.brecha) / e.tiempo_ajuste]];
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

// ----------------------------------------------------------------------
// Modelo de May: puntos de inflexión e histéresis (semana 1, concepto 9)
// ----------------------------------------------------------------------

/** Bisección con la misma secuencia de pasos que `_biseccion` de Python. */
function biseccion(funcion, izquierda, derecha, iteraciones = 80) {
  let valorIzquierda = funcion(izquierda);
  for (let i = 0; i < iteraciones; i++) {
    const medio = 0.5 * (izquierda + derecha), valorMedio = funcion(medio);
    if ((valorMedio < 0) === (valorIzquierda < 0)) { izquierda = medio; valorIzquierda = valorMedio; } else derecha = medio;
  }
  return 0.5 * (izquierda + derecha);
}

/** Tasa de cambio del modelo de May (réplica de tasa_may). */
export const tasaMay = (estado, presion, capacidad = 10) =>
  estado * (1 - estado / capacidad) - presion * estado ** 2 / (1 + estado ** 2);

/** Equilibrios positivos y su estabilidad (réplica de equilibrios_may): [[x, estable], ...]. */
export function equilibriosMay(presion, capacidad = 10, celdas = 2000) {
  const h = (x) => (1 - x / capacidad) - presion * x / (1 + x * x);
  const derivadaH = (x) => -1 / capacidad - presion * (1 - x * x) / (1 + x * x) ** 2;
  const salida = [];
  let anteriorX = capacidad / celdas, anteriorH = h(anteriorX);
  for (let k = 2; k <= celdas; k++) {
    const x = capacidad * k / celdas, valor = h(x);
    if ((valor < 0) !== (anteriorH < 0)) { const raiz = biseccion(h, anteriorX, x); salida.push([raiz, derivadaH(raiz) < 0]); }
    anteriorX = x; anteriorH = valor;
  }
  return salida;
}

/** Puntos de inflexión (réplica de umbrales_may); solo existen si capacidad > 3√3 ≈ 5,196. */
export function umbralesMay(capacidad = 10) {
  if (capacidad <= 3 * Math.sqrt(3))
    throw new Error(`Con capacidad ${capacidad} (menor o igual que 3√3 ≈ 5,196) el modelo de May no tiene puntos de inflexión.`);
  const presion = (x) => (1 + x * x) * (1 - x / capacidad) / x;
  const derivada = (x) => 2 * x ** 3 / capacidad - x * x + 1;
  const bajo = biseccion(derivada, 0.5, capacidad / 3), alto = biseccion(derivada, capacidad / 3, capacidad);
  return {presion_recuperacion: presion(bajo), estado_recuperacion: bajo, presion_colapso: presion(alto), estado_colapso: alto};
}

/** Ida y vuelta de la presión con Euler explícito (réplica de recorrido_may). */
export function recorridoMay({presionMaxima, presionMinima = 1, velocidad = 0.002, paso = 0.1, capacidad = 10} = {}) {
  const u = umbralesMay(capacidad);
  const frontera = 0.5 * (u.estado_recuperacion + u.estado_colapso);
  let estado = Math.max(...equilibriosMay(presionMinima, capacidad).filter((e) => e[1]).map((e) => e[0]));
  const pasosIda = Math.round((presionMaxima - presionMinima) / (velocidad * paso));
  const presiones = [presionMinima], estados = [estado];
  let salto = null, regreso = null;
  for (let k = 1; k <= 2 * pasosIda; k++) {
    const presion = presionMinima + velocidad * paso * (k <= pasosIda ? k : 2 * pasosIda - k);
    const nuevo = estado + paso * tasaMay(estado, presion, capacidad);
    if (k <= pasosIda && salto === null && estado >= frontera && frontera > nuevo) salto = presion;
    if (k > pasosIda && regreso === null && estado < frontera && frontera <= nuevo) regreso = presion;
    estado = nuevo; presiones.push(presion); estados.push(estado);
  }
  return {presion: presiones, estado: estados, presion_salto: salto, presion_regreso: regreso, frontera};
}
