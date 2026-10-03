// componentes.js — Interactividad de las guías de autoestudio.
//
// Mejora progresiva: sin JavaScript, todos los pasos y todas las
// explicaciones quedan visibles y la página se lee completa. Con
// JavaScript:
//   .pasos > .paso          visor paso a paso con Anterior/Siguiente
//   .quiz > .opcion         pregunta con retroalimentación inmediata; las
//                           opciones se barajan en cada carga (salvo
//                           orden="fijo" en el quiz)
//   .prediccion > .opcion   predicción que se guarda y se recuerda después
//                           (no se baraja: el texto posterior cita su letra)
//   .mi-prediccion[data-para]  muestra la predicción guardada
//   .avance-semana[data-semana]  avance del lector en una semana (portada)
// Además: registro de páginas estudiadas, nombres accesibles para los
// controles y las gráficas de los simuladores, cajas numéricas con coma
// decimal, avisos si KaTeX o los simuladores no cargan, tablas anchas con
// señal de desplazamiento, imágenes diferidas que se adelantan en los
// visores y búsqueda que ignora tildes y da prioridad a los títulos.
(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Almacenamiento: localStorage con respaldo en memoria
  // ------------------------------------------------------------------
  const memoria = new Map();
  let almacenamientoPersistente = true;
  try {
    window.localStorage.setItem("guias-mise:prueba", "1");
    window.localStorage.removeItem("guias-mise:prueba");
  } catch (e) {
    almacenamientoPersistente = false;
  }
  const guardar = (clave, valor) => {
    memoria.set(clave, valor);
    try { window.localStorage.setItem(clave, valor); } catch (e) { almacenamientoPersistente = false; }
  };
  const borrar = (clave) => {
    memoria.delete(clave);
    try { window.localStorage.removeItem(clave); } catch (e) { almacenamientoPersistente = false; }
  };
  const leer = (clave) => {
    try {
      const valor = window.localStorage.getItem(clave);
      if (valor !== null) return valor;
    } catch (e) { almacenamientoPersistente = false; }
    return memoria.has(clave) ? memoria.get(clave) : null;
  };

  const boton = (texto, clase, alPulsar) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = clase;
    b.textContent = texto;
    b.addEventListener("click", alPulsar);
    return b;
  };
  const textoOculto = (etiqueta = "p") => {
    const nodo = document.createElement(etiqueta);
    nodo.className = "visualmente-oculto";
    return nodo;
  };
  let contadorIds = 0;
  const nuevoId = (prefijo) => `${prefijo}-${++contadorIds}`;

  // ------------------------------------------------------------------
  // Texto legible de un nodo: las fórmulas de KaTeX se leen una vez, en
  // forma lineal tomada del MathML («τ = 2», «K/τ»), nunca con el texto
  // duplicado que dejan juntos el MathML y el HTML de KaTeX.
  // ------------------------------------------------------------------
  const normalizar = (texto) => String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const OPERADORES = /^[=+−\-×·<>≤≥≈≠→←⇒⇔∝±∈]$/;

  function linealMath(nodo) {
    if (nodo.nodeType === Node.TEXT_NODE) return nodo.data;
    if (nodo.nodeType !== Node.ELEMENT_NODE) return "";
    const etiqueta = nodo.localName;
    if (etiqueta === "annotation" || etiqueta === "annotation-xml") return "";
    const hijos = Array.from(nodo.children);
    const lineal = (x) => (x ? linealMath(x) : "").replace(/\s+/g, " ").trim();
    const grupo = (x) => {
      const s = lineal(x);
      return s.length <= 1 || /^[\p{L}\p{N}.,]+$/u.test(s) ? s : `(${s})`;
    };
    switch (etiqueta) {
      case "mfrac": return `${grupo(hijos[0])}/${grupo(hijos[1])}`;
      case "msup": return `${lineal(hijos[0])}^${grupo(hijos[1])}`;
      case "msub": return `${lineal(hijos[0])}_${grupo(hijos[1])}`;
      case "msubsup": return `${lineal(hijos[0])}_${grupo(hijos[1])}^${grupo(hijos[2])}`;
      case "msqrt": return `√(${hijos.map(lineal).join(" ")})`;
      case "mroot": return `${grupo(hijos[1])}√(${lineal(hijos[0])})`;
      case "mover": case "munder": case "munderover": return hijos.map(lineal).join(" ");
      case "mspace": return " ";
      case "mtable":
        return Array.from(nodo.querySelectorAll(":scope > mtr"))
          .map((fila) => Array.from(fila.children).map(lineal).join(" ")).join("; ");
      case "mo": {
        const s = nodo.textContent.trim();
        return OPERADORES.test(s) ? ` ${s} ` : s;
      }
      default: return Array.from(nodo.childNodes).map(linealMath).join("");
    }
  }

  // Si KaTeX no cargó, las fórmulas quedan en TeX: se traducen las
  // órdenes más comunes para que el nombre accesible no lea barras
  const TEX = {alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", lambda: "λ", mu: "μ",
    pi: "π", rho: "ρ", sigma: "σ", tau: "τ", theta: "θ", phi: "φ", omega: "ω", cdot: "·", times: "×",
    leq: "≤", geq: "≥", le: "≤", ge: "≥", approx: "≈", neq: "≠", to: "→", infty: "∞", pm: "±"};
  const texPlano = (tex) => tex
    .replace(/\\(?:text|mathrm|mathit|operatorname|mathbf)\{([^{}]*)\}/g, "$1")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\([A-Za-z]+)/g, (m, orden) => TEX[orden] ?? "")
    .replace(/\\[,;:! ]/g, " ").replace(/[{}$]/g, "");

  function textoLegible(raiz, quitar = []) {
    const copia = raiz.cloneNode(true);
    if (quitar.length) copia.querySelectorAll(quitar.join(",")).forEach((n) => n.remove());
    copia.querySelectorAll(".katex").forEach((k) => {
      const math = k.querySelector(".katex-mathml math");
      const texto = math ? linealMath(math) : (k.querySelector(".katex-html")?.textContent ?? k.textContent);
      k.replaceWith(document.createTextNode(` ${texto.replace(/\s+/g, " ").trim()} `));
    });
    copia.querySelectorAll(".katex-mathml").forEach((n) => n.remove());
    copia.querySelectorAll("span.math").forEach((m) => { m.textContent = ` ${texPlano(m.textContent)} `; });
    copia.querySelectorAll("img").forEach((img) => {
      img.replaceWith(document.createTextNode(img.alt ? ` ${img.alt} ` : " "));
    });
    return copia.textContent.replace(/\s+/g, " ")
      .replace(/\s+([,.;:)\]»])/g, "$1").replace(/([(\[¿¡«])\s+/g, "$1").trim();
  }

  // Pasa a carga inmediata las imágenes diferidas (loading="lazy") de un nodo
  const cargarImagenes = (raiz) => {
    raiz.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = "eager"; });
  };

  // ------------------------------------------------------------------
  // Visor paso a paso
  // ------------------------------------------------------------------
  const visores = [];

  function iniciarPasos(contenedor) {
    const pasos = Array.from(contenedor.children).filter((n) => n.classList.contains("paso"));
    if (pasos.length < 2) return;
    contenedor.classList.add("pasos-activo");
    const titulo = contenedor.querySelector(":scope > .caja-titulo .caja-texto-titulo");
    const nombre = titulo ? textoLegible(titulo) : "";
    contenedor.setAttribute("role", "region");
    contenedor.setAttribute("aria-label", nombre ? `Paso a paso: ${nombre}` : "Paso a paso");
    let actual = 0;
    let todos = false;

    pasos.forEach((p, j) => {
      p.tabIndex = -1;
      p.setAttribute("role", "group");
      p.setAttribute("aria-label", `Paso ${j + 1} de ${pasos.length}`);
    });

    const barra = document.createElement("div");
    barra.className = "pasos-barra";
    const puntos = document.createElement("div");
    puntos.className = "pasos-puntos";
    const marcas = pasos.map((_, i) => {
      const m = boton("", "pasos-punto", () => ir(i, {enfocarPaso: true}));
      m.setAttribute("aria-label", `Ir al paso ${i + 1}`);
      puntos.appendChild(m);
      return m;
    });
    const contador = document.createElement("span");
    contador.className = "pasos-contador";
    const anuncio = textoOculto();
    anuncio.setAttribute("aria-live", "polite");
    const anterior = boton("◀ Anterior", "pasos-boton", () => {
      if (anterior.getAttribute("aria-disabled") !== "true") ir(actual - 1);
    });
    const siguiente = boton("Siguiente ▶", "pasos-boton pasos-principal", () => {
      if (siguiente.getAttribute("aria-disabled") !== "true") ir(actual + 1);
    });
    const verTodos = boton("Ver todos los pasos", "pasos-todos", () => {
      todos = !todos;
      actualizar();
      anuncio.textContent = todos ? `Se muestran los ${pasos.length} pasos.` : `Modo paso a paso, paso ${actual + 1} de ${pasos.length}.`;
    });

    const navegacion = document.createElement("div");
    navegacion.className = "pasos-navegacion";
    navegacion.append(anterior, contador, siguiente);
    barra.append(puntos, navegacion, verTodos, anuncio);
    contenedor.appendChild(barra);

    contenedor.addEventListener("keydown", (evento) => {
      if (evento.target.closest("input, textarea, select, .opcion")) return;
      if (evento.key === "ArrowRight") { ir(actual + 1); evento.preventDefault(); }
      if (evento.key === "ArrowLeft") { ir(actual - 1); evento.preventDefault(); }
    });

    // El foco pasa al paso nuevo cuando el lector lo eligió (puntos) o
    // cuando estaba dentro del paso que se oculta; con Anterior/Siguiente
    // el foco se queda en el botón y la región viva lee el paso nuevo.
    function ir(i, {enfocarPaso = false, anunciar = true} = {}) {
      const destino = Math.max(0, Math.min(pasos.length - 1, i));
      const focoDentro = !todos && pasos[actual].contains(document.activeElement);
      const cambio = destino !== actual || todos;
      actual = destino;
      todos = false;
      actualizar();
      if (enfocarPaso || focoDentro) {
        pasos[actual].focus();
      } else if (anunciar && cambio) {
        anuncio.textContent = `Paso ${actual + 1} de ${pasos.length}. ${textoLegible(pasos[actual])}`;
      }
    }
    function actualizar() {
      pasos.forEach((p, j) => {
        p.hidden = !todos && j !== actual;
        p.classList.toggle("paso-actual", j === actual);
        p.setAttribute("data-numero", `Paso ${j + 1} de ${pasos.length}`);
        // Las imágenes llevan carga diferida (guias.lua): la del paso
        // siguiente se pide ya, para que aparezca sin espera al avanzar
        if (j === actual + 1) cargarImagenes(p);
      });
      marcas.forEach((m, j) => {
        m.classList.toggle("visto", j < actual);
        m.classList.toggle("actual", j === actual);
        if (j === actual) m.setAttribute("aria-current", "step");
        else m.removeAttribute("aria-current");
      });
      contador.textContent = todos ? `${pasos.length} pasos` : `Paso ${actual + 1} de ${pasos.length}`;
      anterior.setAttribute("aria-disabled", String(todos || actual === 0));
      siguiente.setAttribute("aria-disabled", String(todos || actual === pasos.length - 1));
      navegacion.hidden = todos;
      puntos.hidden = todos;
      verTodos.textContent = todos ? "Volver al modo paso a paso" : "Ver todos los pasos";
      contenedor.classList.toggle("pasos-todos-visibles", todos);
      // Las gráficas que dependen del ancho se recalculan al mostrarse
      window.dispatchEvent(new Event("resize"));
    }
    actualizar();
    visores.push({pasos, ir});
  }

  // ------------------------------------------------------------------
  // Preguntas y predicciones
  // ------------------------------------------------------------------
  function textoOpcion(opcion) {
    return textoLegible(opcion, [".porque", ".opcion-letra"]);
  }

  // Fisher-Yates sobre las posiciones que ocupan las opciones; el orden
  // queda fijo durante la visita (los reintentos no rebarajan)
  function barajar(opciones) {
    const orden = opciones.slice();
    for (let i = orden.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orden[i], orden[j]] = [orden[j], orden[i]];
    }
    const lugares = opciones.map((o) => {
      const lugar = document.createComment("opcion");
      o.replaceWith(lugar);
      return lugar;
    });
    lugares.forEach((lugar, k) => lugar.replaceWith(orden[k]));
    return orden;
  }

  function iniciarPregunta(caja) {
    // [texto]{.porque} en un párrafo propio: la clase pasa al párrafo, así
    // al ocultarlo no queda un párrafo vacío con margen
    caja.querySelectorAll("span.porque").forEach((span) => {
      const padre = span.parentElement;
      if (padre.tagName === "P" && padre.textContent.trim() === span.textContent.trim()) {
        padre.classList.add("porque");
        span.classList.remove("porque");
      }
    });
    const esPrediccion = caja.classList.contains("prediccion");
    let opciones = Array.from(caja.children).filter((n) => n.classList.contains("opcion"));
    if (opciones.length === 0) return;
    if (!esPrediccion && caja.dataset.orden !== "fijo") opciones = barajar(opciones);
    const explicacion = Array.from(caja.children).find((n) => n.classList.contains("explicacion"));
    const base = caja.id || nuevoId("pregunta");

    // La pregunta es un grupo con nombre: etiqueta de la caja + enunciado
    const titulo = caja.querySelector(":scope > .caja-titulo");
    const enunciado = Array.from(caja.children).find((n) =>
      !n.classList.contains("caja-titulo") && !n.classList.contains("opcion") && !n.classList.contains("explicacion"));
    const nombres = [];
    if (titulo) { titulo.id = titulo.id || `${base}-titulo`; nombres.push(titulo.id); }
    if (enunciado) { enunciado.id = enunciado.id || `${base}-enunciado`; nombres.push(enunciado.id); }
    caja.setAttribute("role", "group");
    if (nombres.length) caja.setAttribute("aria-labelledby", nombres.join(" "));

    const aviso = document.createElement("p");
    aviso.className = "quiz-aviso";
    const anuncio = textoOculto();
    anuncio.setAttribute("aria-live", "polite");
    caja.append(aviso, anuncio);
    caja.classList.add("quiz-activo");
    if (explicacion) explicacion.hidden = true;

    opciones.forEach((opcion, i) => {
      const letra = String.fromCharCode(65 + i);
      const marca = document.createElement("span");
      marca.className = "opcion-letra";
      marca.setAttribute("aria-hidden", "true");
      marca.textContent = letra;
      opcion.prepend(marca);
      opcion.setAttribute("role", "button");
      opcion.setAttribute("aria-pressed", "false");
      opcion.setAttribute("aria-label", `Opción ${letra}: ${textoOpcion(opcion)}`);
      opcion.dataset.letra = letra;
      opcion.tabIndex = 0;
      opcion.querySelectorAll(".porque").forEach((p, k) => {
        p.hidden = true;
        p.id = p.id || `${base}-porque-${i}-${k}`;
      });
      opcion.addEventListener("click", () => elegir(i));
      opcion.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter" || evento.key === " ") { elegir(i); evento.preventDefault(); }
      });
    });

    function marcar(i) {
      opciones.forEach((o, j) => {
        o.classList.remove("elegida", "acierto", "fallo");
        o.setAttribute("aria-pressed", String(j === i));
        o.removeAttribute("aria-describedby");
        o.querySelectorAll(".porque").forEach((p) => { p.hidden = true; });
      });
      const opcion = opciones[i];
      const porques = Array.from(opcion.querySelectorAll(".porque"));
      opcion.classList.add("elegida");
      porques.forEach((p) => { p.hidden = false; });
      if (porques.length) opcion.setAttribute("aria-describedby", porques.map((p) => p.id).join(" "));
      return porques.map((p) => textoLegible(p)).join(" ");
    }

    function elegir(i) {
      const opcion = opciones[i];
      const pista = marcar(i);
      const letra = opcion.dataset.letra;

      if (esPrediccion) {
        if (caja.id) {
          guardar(`guias-mise:prediccion:${caja.id}`, `${letra}. ${textoOpcion(opcion)}`);
          mostrarPredicciones();
        }
        aviso.textContent = almacenamientoPersistente
          ? "Predicción anotada. Siga leyendo: más adelante la comprobará con el simulador."
          : "Predicción anotada para esta visita. Su navegador no permite guardarla, así que se perderá al recargar o cerrar la página.";
        anuncio.textContent = `Predicción anotada: opción ${letra}. ${pista}`.trim();
        return;
      }
      const correcta = opcion.dataset.correcta === "si";
      opcion.classList.add(correcta ? "acierto" : "fallo");
      aviso.textContent = correcta ? "Correcto." : "Todavía no. Lea la pista y vuelva a intentarlo.";
      anuncio.textContent = `Opción ${letra}: ${correcta ? "correcta" : "todavía no"}. ${pista}`.trim();
      if (explicacion) explicacion.hidden = !correcta;
    }

    // Predicción ya registrada en una visita anterior: se restaura si la
    // opción guardada sigue existiendo con el mismo texto
    if (esPrediccion && caja.id) {
      const guardada = leer(`guias-mise:prediccion:${caja.id}`);
      const i = guardada ? opciones.findIndex((o) => `${o.dataset.letra}. ${textoOpcion(o)}` === guardada) : -1;
      if (i >= 0) {
        marcar(i);
        aviso.textContent = "Esta es la predicción que usted anotó. Puede cambiarla eligiendo otra opción.";
      }
    }
  }

  function mostrarPredicciones() {
    document.querySelectorAll(".mi-prediccion[data-para]").forEach((marca) => {
      const guardada = leer(`guias-mise:prediccion:${marca.dataset.para}`);
      marca.textContent = guardada ? `«${guardada}»` : "(aún no ha registrado una predicción)";
    });
  }

  // ------------------------------------------------------------------
  // Registro de páginas estudiadas (solo en el navegador del lector)
  // ------------------------------------------------------------------
  const PREFIJO_ESTUDIADA = "guias-mise:estudiada:";
  const raizSitio = new URL(document.querySelector('meta[name="quarto:offset"]')?.content ?? "./", window.location.href);

  function rutaDe(direccion) {
    let url;
    try { url = new URL(direccion, window.location.href); } catch (e) { return null; }
    if (url.origin !== raizSitio.origin) return null;
    const raiz = decodeURIComponent(raizSitio.pathname);
    let ruta = decodeURIComponent(url.pathname);
    if (!ruta.startsWith(raiz)) return null;
    ruta = ruta.slice(raiz.length);
    if (ruta === "" || ruta.endsWith("/")) ruta += "index.html";
    else if (!/\.[a-z0-9]+$/i.test(ruta)) ruta += ".html";
    return ruta;
  }
  const esPaginaDeConcepto = (ruta) => /^(semana\d+|caso-guia)\/\d\d-[^/]+\.html$/.test(ruta ?? "");
  const estaEstudiada = (ruta) => leer(PREFIJO_ESTUDIADA + ruta) === "1";

  function marcarEnlaces() {
    document.querySelectorAll(".marca-estudiada-envoltura").forEach((n) => n.remove());
    const enlaces = Array.from(document.querySelectorAll("#quarto-sidebar a.sidebar-link, main table a[href]"));
    enlaces.forEach((enlace) => {
      const ruta = rutaDe(enlace.getAttribute("href"));
      if (!esPaginaDeConcepto(ruta) || !estaEstudiada(ruta)) return;
      const envoltura = document.createElement("span");
      envoltura.className = "marca-estudiada-envoltura";
      envoltura.innerHTML = '<span class="marca-estudiada" aria-hidden="true">✓</span><span class="visualmente-oculto"> (estudiada)</span>';
      enlace.appendChild(envoltura);
    });
    // Avance por semana en la portada: [—]{.avance-semana semana="semana4"}
    const paginas = Array.from(document.querySelectorAll("#quarto-sidebar a.sidebar-link"))
      .map((a) => rutaDe(a.getAttribute("href"))).filter(esPaginaDeConcepto);
    document.querySelectorAll(".avance-semana[data-semana]").forEach((celda) => {
      const propias = [...new Set(paginas.filter((r) => r.startsWith(`${celda.dataset.semana}/`)))];
      if (!propias.length) return;
      const hechas = propias.filter(estaEstudiada).length;
      celda.textContent = `${hechas} de ${propias.length}`;
    });
  }

  function iniciarCierre() {
    const principal = document.querySelector("main#quarto-document-content") ?? document.querySelector("main");
    if (!principal) return;
    principal.tabIndex = -1; // destino del enlace «Saltar al contenido»
    // Quarto inserta include-before-body dentro de <main>: el enlace de
    // salto se lleva al comienzo de <body> para que sea lo primero al tabular
    const salto = document.querySelector(".saltar-contenido");
    if (salto && salto.parentElement !== document.body) document.body.prepend(salto);
    // El desplazamiento suave de Quarto intercepta los enlaces con ancla y
    // el foco no llegaría al contenido: se mueve aquí de forma explícita
    salto?.addEventListener("click", (evento) => {
      evento.preventDefault();
      principal.focus({preventScroll: true});
      principal.scrollIntoView({block: "start"});
    });
    const ruta = rutaDe(window.location.href);
    const fecha = document.querySelector('meta[name="guias-mise:fecha"]')?.content;
    if (!esPaginaDeConcepto(ruta) && !fecha) return;
    const cierre = document.createElement("div");
    cierre.className = "cierre-pagina";
    if (esPaginaDeConcepto(ruta)) {
      const progreso = document.createElement("div");
      progreso.className = "progreso-pagina";
      const estado = document.createElement("span");
      estado.className = "progreso-aviso";
      estado.setAttribute("aria-live", "polite");
      const marcarPagina = boton("Estudié esta página", "boton-estudiada", () => {
        const ahora = !estaEstudiada(ruta);
        if (ahora) guardar(PREFIJO_ESTUDIADA + ruta, "1");
        else borrar(PREFIJO_ESTUDIADA + ruta);
        pintar();
        estado.textContent = !almacenamientoPersistente
          ? "Anotado solo para esta visita: su navegador no permite guardar el avance."
          : ahora ? "Anotado en su avance. La marca ✓ aparece en el menú lateral." : "Marca retirada.";
        marcarEnlaces();
      });
      const pintar = () => marcarPagina.setAttribute("aria-pressed", String(estaEstudiada(ruta)));
      pintar();
      progreso.append(marcarPagina, estado);
      cierre.appendChild(progreso);
    }
    if (fecha) {
      const version = document.createElement("p");
      version.className = "pie-actualizacion";
      version.textContent = `Versión del ${fecha}. Su avance y sus predicciones se guardan solo en este navegador.`;
      cierre.appendChild(version);
    }
    principal.appendChild(cierre);
  }

  // ------------------------------------------------------------------
  // Cajas numéricas en español (coma decimal y espacio de miles)
  // ------------------------------------------------------------------
  // Inputs.range e Inputs.number de Observable muestran el valor en una
  // casilla type=number, que el navegador escribe con punto («0.3»,
  // «1500») sin importar el idioma de la página. Esa casilla se oculta y
  // en su lugar queda una de texto (rol spinbutton, inputmode decimal)
  // que muestra «0,30» o «1 500» y acepta coma o punto al escribir. El
  // valor llega a la celda OJS por el camino documentado de Observable:
  // el setter form.value (que recorta al intervalo y al paso) y un evento
  // input en el formulario. Las flechas suben y bajan un paso, y Re Pág y
  // Av Pág, diez.
  const ESPACIOS = /[\s\u00A0\u2009\u202F]/g;
  const valorNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const numeroNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "valueAsNumber");

  // Decimales que exige el paso del control («0.05» → 2; «100» → 0)
  function decimalesDelPaso(paso) {
    if (!(paso > 0) || !isFinite(paso)) return null;
    const [mantisa, exponente] = String(paso).toLowerCase().split("e");
    const decimales = (mantisa.split(".")[1] ?? "").length - Number(exponente ?? 0);
    return Math.max(0, Math.min(6, decimales));
  }

  // Igual que formatoNumero de mise_sd.js: coma decimal y espacio fino de
  // miles; los años y las semillas van sin separador («2016», no «2 016»)
  function formatoEspanol(valor, decimales, agrupar) {
    const opciones = decimales === null
      ? {maximumFractionDigits: 3, useGrouping: agrupar}
      : {minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: agrupar};
    return valor.toLocaleString("es-CO", opciones).replace(/\./g, "\u202F");
  }

  // Interpretaciones posibles de lo escrito, en orden de preferencia: la
  // coma o el punto únicos son decimales («0,3», «0.3»); con los dos, el
  // último es el decimal («1.500,5», «1,500.5»); un separador repetido o
  // seguido de grupos de tres cifras puede ser de miles («1.500» = 1500
  // cuando 1,5 queda fuera del control). Devuelve [] si falta terminar
  // («», «-», «2,») y null si no es un número.
  function interpretaciones(texto) {
    const s = String(texto).replace(ESPACIOS, "").replace(/[\u2212\u2012\u2013]/g, "-");
    if (s === "" || /^[-+]?[.,]?$/.test(s) || /^[-+]?\d+[.,]$/.test(s)) return [];
    if (!/^[-+]?[\d.,]+$/.test(s)) return null;
    const signo = s[0] === "-" ? -1 : 1;
    const cuerpo = s.replace(/^[-+]/, "");
    const numero = (t) => (/^(\d+(\.\d*)?|\.\d+)$/.test(t) ? signo * Number(t) : NaN);
    const comas = cuerpo.split(",").length - 1;
    const puntos = cuerpo.split(".").length - 1;
    const miles = /^\d{1,3}([.,]\d{3})+$/.test(cuerpo) && (comas === 0 || puntos === 0)
      ? numero(cuerpo.replace(/[.,]/g, "")) : NaN;
    let decimal = NaN;
    if (comas && puntos) {
      const separador = cuerpo.lastIndexOf(",") > cuerpo.lastIndexOf(".") ? "," : ".";
      const deMiles = separador === "," ? "." : ",";
      if (cuerpo.split(separador).length === 2 && /^\d{1,3}([.,]\d{3})*$/.test(cuerpo.split(separador)[0])) {
        decimal = numero(cuerpo.split(deMiles).join("").replace(separador, "."));
      }
    } else if (comas + puntos === 1) {
      decimal = numero(cuerpo.replace(",", "."));
    } else if (comas + puntos === 0) {
      decimal = numero(cuerpo);
    }
    const candidatos = [decimal, miles].filter((v) => isFinite(v));
    return candidatos.length ? candidatos : null;
  }

  function espanolizarCasilla(numero) {
    const formulario = numero.closest('form[class^="oi-"]');
    if (!formulario || numero.dataset.espanol || !("value" in formulario)) return;
    numero.dataset.espanol = "si";
    const deslizador = formulario.querySelector('input[type="range"]');
    const minimo = numero.min === "" ? -Infinity : Number(numero.min);
    const maximo = numero.max === "" ? Infinity : Number(numero.max);
    const paso = numero.step === "" || numero.step === "any" ? NaN : Number(numero.step);
    const decimales = decimalesDelPaso(paso);
    const etiqueta = formulario.querySelector(":scope > label");
    const agrupar = !/(^|[^\p{L}])(año|semilla)([^\p{L}]|$)/iu.test(etiqueta?.textContent ?? "");
    const pasoTeclado = isFinite(paso) ? paso
      : isFinite(maximo - minimo) ? (maximo - minimo) / 100 : 1;

    const texto = document.createElement("input");
    texto.type = "text";
    texto.className = "numero-es";
    texto.autocomplete = "off";
    texto.spellcheck = false;
    texto.disabled = numero.disabled;
    texto.readOnly = numero.readOnly;
    if (numero.placeholder) texto.placeholder = numero.placeholder;
    // El teclado decimal del teléfono no trae el signo menos
    if (!(minimo < 0)) texto.inputMode = "decimal";
    texto.setAttribute("role", "spinbutton");
    if (isFinite(minimo)) texto.setAttribute("aria-valuemin", String(minimo));
    if (isFinite(maximo)) texto.setAttribute("aria-valuemax", String(maximo));
    // La etiqueta de Observable apunta al id de la casilla numérica: pasa
    // a la de texto, y la original sale de la vista y del orden de foco
    if (numero.id) { texto.id = numero.id; numero.removeAttribute("id"); }
    numero.classList.add("numero-original");
    numero.hidden = true;
    numero.tabIndex = -1;
    numero.setAttribute("aria-hidden", "true");
    numero.after(texto);

    const formatear = (v) => (typeof v === "number" && isFinite(v) ? formatoEspanol(v, decimales, agrupar) : "");
    const valido = (v) => {
      if (!(v >= minimo && v <= maximo)) return false;
      if (!isFinite(paso)) return true;
      const k = (v - (isFinite(minimo) ? minimo : 0)) / paso;
      return Math.abs(k - Math.round(k)) < 1e-6;
    };
    function mostrar() {
      const v = formulario.value;
      texto.value = formatear(v);
      texto.removeAttribute("aria-invalid");
      if (typeof v === "number" && isFinite(v)) {
        texto.setAttribute("aria-valuenow", String(v));
        texto.setAttribute("aria-valuetext", texto.value);
      }
    }
    // Entrega un valor a Observable como lo haría el propio control
    let escribiendo = false;
    function fijar(v, {desdeTexto = false} = {}) {
      escribiendo = desdeTexto;
      try {
        if (!Object.is(formulario.value, v)) {
          formulario.value = v;
          formulario.dispatchEvent(new Event("input", {bubbles: true}));
        }
      } finally {
        escribiendo = false;
      }
      const actual = formulario.value;
      texto.setAttribute("aria-valuenow", String(actual));
      texto.setAttribute("aria-valuetext", formatear(actual));
      if (!desdeTexto) mostrar();
    }
    // Lo más cercano que el control admite: recorta y redondea al paso
    function ajustar(v) {
      let x = Math.max(minimo, Math.min(maximo, v));
      if (isFinite(paso)) {
        const base = isFinite(minimo) ? minimo : 0;
        x = base + Math.round((x - base) / paso) * paso;
        if (x > maximo) x -= paso;
        if (decimales !== null) x = Number(x.toFixed(decimales));
      }
      return x;
    }

    // Deslizador, teclado del deslizador o código de la página: Observable
    // escribe en la casilla oculta; la de texto se actualiza después
    let pendiente = false;
    const alCambiarOriginal = () => {
      if (escribiendo || pendiente) return;
      pendiente = true;
      queueMicrotask(() => { pendiente = false; mostrar(); });
    };
    Object.defineProperty(numero, "value", {
      configurable: true,
      get() { return valorNativo.get.call(this); },
      set(v) { valorNativo.set.call(this, v); alCambiarOriginal(); },
    });
    Object.defineProperty(numero, "valueAsNumber", {
      configurable: true,
      get() { return numeroNativo.get.call(this); },
      set(v) { numeroNativo.set.call(this, v); alCambiarOriginal(); },
    });

    texto.addEventListener("input", (evento) => {
      // La celda OJS recibe el evento del formulario, no el de esta casilla
      evento.stopPropagation();
      const candidatos = interpretaciones(texto.value);
      if (candidatos === null) { texto.setAttribute("aria-invalid", "true"); return; }
      if (!candidatos.length) { texto.removeAttribute("aria-invalid"); return; }
      const v = candidatos.find(valido);
      if (v === undefined) { texto.setAttribute("aria-invalid", "true"); return; }
      texto.removeAttribute("aria-invalid");
      fijar(v, {desdeTexto: true});
    });
    // Al confirmar (Intro o salir de la casilla) queda el valor admitido
    // más cercano, con el formato en español
    const confirmar = () => {
      const candidatos = interpretaciones(texto.value);
      const v = candidatos?.find(valido) ?? (candidatos?.length ? ajustar(candidatos[0]) : undefined);
      if (v !== undefined) fijar(v); else mostrar();
    };
    texto.addEventListener("change", (evento) => { evento.stopPropagation(); confirmar(); });
    texto.addEventListener("keydown", (evento) => {
      const pasos = {ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10}[evento.key];
      if (evento.key === "Enter") { confirmar(); return; }
      if (!pasos || texto.disabled || texto.readOnly) return;
      evento.preventDefault();
      const actual = typeof formulario.value === "number" && isFinite(formulario.value)
        ? formulario.value : (isFinite(minimo) ? minimo : 0);
      fijar(ajustar(actual + pasos * pasoTeclado));
      texto.select();
    });
    mostrar();
  }

  // ------------------------------------------------------------------
  // Simuladores (OJS): nombres accesibles, lecturas vivas y gráficas
  // ------------------------------------------------------------------
  function contextoDe(nodo) {
    const caja = nodo.closest(".caja");
    const titulo = caja?.querySelector(":scope > .caja-titulo .caja-texto-titulo");
    if (titulo) return textoLegible(titulo);
    let anterior = nodo.closest("section");
    const encabezado = anterior?.querySelector(":scope > h2, :scope > h3, :scope > h4");
    return encabezado ? textoLegible(encabezado, [".anchorjs-link"]) : "";
  }
  const limpiarEje = (texto) => (texto ?? "").replace(/[↑↓←→]/g, "").replace(/\s+/g, " ").trim();

  function mejorarSimuladores(raiz) {
    raiz.querySelectorAll('form[class^="oi-"] input[type="number"]').forEach(espanolizarCasilla);
    // Observable Inputs enlaza la etiqueta solo con la casilla numérica
    raiz.querySelectorAll('form[class^="oi-"]').forEach((formulario) => {
      const etiqueta = formulario.querySelector(":scope > label");
      const texto = etiqueta ? textoLegible(etiqueta) : "";
      if (!texto) return;
      formulario.querySelectorAll("input, select, textarea").forEach((control) => {
        if (control.hidden || (control.labels && control.labels.length) || control.hasAttribute("aria-label")) return;
        const tipo = control.type === "range" ? " (deslizador)" : "";
        control.setAttribute("aria-label", texto + tipo);
      });
    });
    // Las lecturas se reemplazan al mover un control: la celda que las
    // contiene se vuelve región viva para anunciar las cifras nuevas
    raiz.querySelectorAll(".lectura-simulador").forEach((lectura) => {
      const celda = lectura.closest('[id^="ojs-cell-"]') ?? lectura.parentElement;
      if (celda && !celda.hasAttribute("aria-live")) {
        celda.setAttribute("aria-live", "polite");
        celda.setAttribute("aria-atomic", "true");
      }
    });
    // Gráficas de Observable Plot sin nombre: role="img" y una etiqueta
    // con el título del simulador, los ejes y las series
    raiz.querySelectorAll('svg[class^="plot-"]').forEach((svg) => {
      if (svg.getAttribute("role") === "img") return;
      svg.setAttribute("role", "img");
      if (svg.hasAttribute("aria-label")) return;
      const ejeX = limpiarEje(svg.querySelector('g[aria-label="x-axis label"]')?.textContent);
      const ejeY = limpiarEje(svg.querySelector('g[aria-label="y-axis label"]')?.textContent);
      const series = Array.from(svg.closest("figure")?.querySelectorAll('[class$="-swatch"]') ?? [])
        .map((s) => s.textContent.trim()).filter(Boolean);
      const contexto = contextoDe(svg);
      const partes = [contexto ? `Gráfica del simulador «${contexto}»` : "Gráfica del simulador"];
      if (ejeX) partes.push(`eje horizontal: ${ejeX}`);
      if (ejeY) partes.push(`eje vertical: ${ejeY}`);
      if (series.length) partes.push(`series: ${series.join(", ")}`);
      svg.setAttribute("aria-label", `${partes.join("; ")}. Las cifras clave aparecen en las lecturas debajo de la gráfica.`);
    });
  }

  // ------------------------------------------------------------------
  // Avisos de carga: KaTeX y simuladores dependen de un CDN
  // ------------------------------------------------------------------
  function avisar(clave, html) {
    if (document.getElementById(`aviso-${clave}`)) return;
    const principal = document.querySelector("main");
    if (!principal) return;
    const aviso = document.createElement("div");
    aviso.id = `aviso-${clave}`;
    aviso.className = "aviso-carga";
    aviso.setAttribute("role", "status");
    aviso.innerHTML = html;
    const cabecera = principal.querySelector("#title-block-header");
    if (cabecera) cabecera.after(aviso); else principal.prepend(aviso);
  }
  function revisarKatex() {
    if (document.querySelector("span.math") && !window.katex) {
      avisar("katex", "<strong>Las fórmulas no cargaron.</strong> La biblioteca KaTeX se descarga de cdn.jsdelivr.net; revise su conexión o si su red bloquea ese sitio, y recargue la página. Mientras tanto, las fórmulas aparecen en notación LaTeX.");
    }
  }
  function revisarSimuladores() {
    if (document.querySelector("main .observablehq--error")) {
      avisar("simuladores", "<strong>Uno o más simuladores no cargaron.</strong> Usan bibliotecas que se descargan de cdn.jsdelivr.net; revise su conexión o si su red bloquea ese sitio, y recargue la página. El texto, los pasos y las preguntas funcionan sin ellos. Si el problema sigue, cuéntelo en el foro del curso.");
    }
  }

  // ------------------------------------------------------------------
  // Tablas anchas en el teléfono: pista visible y desplazamiento con teclado
  // ------------------------------------------------------------------
  function marcarTablas() {
    document.querySelectorAll("main table").forEach((tabla) => {
      const ancha = tabla.scrollWidth > tabla.clientWidth + 2;
      tabla.classList.toggle("tabla-desplazable", ancha);
      let pista = tabla.previousElementSibling?.classList.contains("tabla-pista") ? tabla.previousElementSibling : null;
      if (ancha) {
        if (!pista) {
          pista = document.createElement("p");
          pista.className = "tabla-pista";
          pista.setAttribute("aria-hidden", "true");
          pista.textContent = "Deslice la tabla hacia los lados para ver todas las columnas.";
          tabla.before(pista);
        }
        if (!tabla.hasAttribute("tabindex")) { tabla.tabIndex = 0; tabla.dataset.focoAgregado = "si"; }
      } else {
        pista?.remove();
        if (tabla.dataset.focoAgregado === "si") { tabla.removeAttribute("tabindex"); delete tabla.dataset.focoAgregado; }
      }
    });
  }

  // ------------------------------------------------------------------
  // Búsqueda: sin tildes, títulos primero y paso abierto al llegar
  // ------------------------------------------------------------------
  const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const empiezaPalabra = (texto, consulta) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(consulta)}`, "u").test(texto);

  // Formas exactas (con sus tildes) en que la consulta aparece en un texto
  function variantesEn(texto, consulta) {
    const q = normalizar(consulta).replace(/\s+/g, " ").trim();
    if (!texto || q.length < 2) return [];
    let plano = "";
    const mapa = [];
    for (let i = 0; i < texto.length; i++) {
      const caracter = /\s/.test(texto[i]) ? " " : normalizar(texto[i]);
      if (caracter === " " && plano.endsWith(" ")) continue;
      for (const c of caracter) { plano += c; mapa.push(i); }
    }
    const vistas = new Map();
    for (let desde = plano.indexOf(q); desde !== -1 && vistas.size < 20; desde = plano.indexOf(q, desde + q.length)) {
      const forma = texto.slice(mapa[desde], mapa[desde + q.length - 1] + 1);
      if (!vistas.has(forma.toLowerCase())) vistas.set(forma.toLowerCase(), forma);
    }
    return Array.from(vistas.values());
  }

  function mejorarBusqueda() {
    const FuseOriginal = window.Fuse;
    const obtener = FuseOriginal?.config?.getFn;
    if (typeof FuseOriginal === "function" && typeof obtener === "function" && !FuseOriginal.guiasMise) {
      const normalizarValor = (v) => (Array.isArray(v) ? v.map(normalizarValor) : typeof v === "string" ? normalizar(v) : v);
      class FuseSinTildes extends FuseOriginal {
        constructor(documentos, opciones = {}) {
          super(documentos, {...opciones, getFn: (objeto, ruta) => normalizarValor(obtener(objeto, ruta))});
        }
        search(consulta, opciones = {}) {
          if (typeof consulta !== "string") return super.search(consulta, opciones);
          const q = normalizar(consulta).replace(/\s+/g, " ").trim();
          const limite = opciones.limit;
          const resultados = super.search(q, {...opciones, limit: undefined});
          // Primero las páginas cuyo título empieza con la consulta, luego
          // las que la tienen en el título, luego en el subtítulo de sección
          const nivel = (r) => {
            const titulo = normalizar(r.item?.title ?? "");
            const seccion = normalizar(r.item?.section ?? "");
            if (titulo.startsWith(q)) return 0;
            if (empiezaPalabra(titulo, q)) return 1;
            if (empiezaPalabra(seccion, q)) return 2;
            return 3;
          };
          const ordenados = resultados.map((r, k) => ({r, k, n: nivel(r)}))
            .sort((a, b) => a.n - b.n || a.k - b.k).map((x) => x.r);
          // Quarto agrupa por página y muestra tres secciones de cada una:
          // las demás secciones van al final para que una página con muchas
          // coincidencias no deje sin cupo a las otras dentro del límite
          const porPagina = new Map();
          const primeras = [];
          const resto = [];
          ordenados.forEach((r) => {
            const pagina = String(r.item?.href ?? "").split("#")[0];
            const n = porPagina.get(pagina) ?? 0;
            porPagina.set(pagina, n + 1);
            (n < 3 ? primeras : resto).push(r);
          });
          const final = primeras.concat(resto);
          return typeof limite === "number" && limite > 0 ? final.slice(0, limite) : final;
        }
      }
      FuseSinTildes.guiasMise = true;
      window.Fuse = FuseSinTildes;
    }
    // quarto-search.js resalta la consulta tal como se escribió; aquí se
    // traduce a las formas con tilde que aparecen en el texto
    if (typeof window.highlightMatch === "function") {
      const original = window.highlightMatch;
      window.highlightMatch = (consulta, texto) => original(variantesEn(texto, consulta)[0] ?? consulta, texto);
    }
    if (typeof window.highlight === "function") {
      const original = window.highlight;
      window.highlight = (consulta, elemento) => {
        const variantes = variantesEn(elemento.textContent, consulta);
        if (!variantes.length) return original(consulta, elemento);
        variantes.forEach((v) => original(v, elemento));
      };
    }
    if (typeof window.clearHighlight === "function") {
      const original = window.clearHighlight;
      window.clearHighlight = (consulta, elemento) => {
        original(consulta, elemento);
        const q = normalizar(consulta);
        elemento.querySelectorAll("mark").forEach((m) => {
          if (normalizar(m.textContent) === q) m.replaceWith(document.createTextNode(m.textContent));
        });
      };
    }
  }

  // Al llegar desde la búsqueda (?q=), quarto-search.js marca las
  // coincidencias con <mark>; se abre el paso, la solución plegada o el
  // código que las contiene para que se vean y el navegador llegue a ellas
  function abrirCoincidencias() {
    if (!document.querySelector("main mark")) return;
    visores.forEach(({pasos, ir}) => {
      const k = pasos.findIndex((p) => p.querySelector("mark"));
      if (k >= 0) ir(k, {anunciar: false});
    });
    document.querySelectorAll("main mark").forEach((m) => {
      const plegado = m.closest(".callout-collapse.collapse:not(.show)");
      if (plegado) {
        plegado.classList.add("show");
        const cabecera = plegado.parentElement?.querySelector(":scope > .callout-header");
        cabecera?.classList.remove("collapsed");
        cabecera?.setAttribute("aria-expanded", "true");
      }
      m.closest("details:not([open])")?.setAttribute("open", "");
    });
  }

  // ------------------------------------------------------------------
  // Impresión: se despliega el código plegado (y se restaura después) y
  // se piden las imágenes diferidas que aún no se han visto
  // ------------------------------------------------------------------
  let abiertosParaImprimir = [];
  window.addEventListener("beforeprint", () => {
    cargarImagenes(document);
    abiertosParaImprimir = Array.from(document.querySelectorAll("main details:not([open]):not(.hidden)"));
    abiertosParaImprimir.forEach((d) => d.setAttribute("open", ""));
  });
  window.addEventListener("afterprint", () => {
    abiertosParaImprimir.forEach((d) => d.removeAttribute("open"));
    abiertosParaImprimir = [];
  });

  // ------------------------------------------------------------------
  // Arranque
  // ------------------------------------------------------------------
  // La búsqueda se ajusta de inmediato: quarto-search.js resalta la
  // consulta en DOMContentLoaded, antes de iniciar() (registrado después)
  try { mejorarBusqueda(); } catch (e) { /* la búsqueda original sigue funcionando */ }

  function iniciar() {
    document.querySelectorAll(".pasos").forEach(iniciarPasos);
    document.querySelectorAll(".quiz, .prediccion").forEach(iniciarPregunta);
    mostrarPredicciones();
    abrirCoincidencias();
    iniciarCierre();
    marcarEnlaces();
    mejorarSimuladores(document);
    marcarTablas();

    const principal = document.querySelector("main");
    if (principal && "MutationObserver" in window) {
      let pendiente = false;
      new MutationObserver(() => {
        if (pendiente) return;
        pendiente = true;
        window.requestAnimationFrame(() => {
          pendiente = false;
          mejorarSimuladores(principal);
          revisarSimuladores();
        });
      }).observe(principal, {childList: true, subtree: true});
    }
    let espera;
    window.addEventListener("resize", () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(marcarTablas, 200);
    });
    const alCargar = () => {
      revisarKatex();
      marcarTablas();
      window.setTimeout(revisarSimuladores, 8000);
    };
    if (document.readyState === "complete") alCargar();
    else window.addEventListener("load", alCargar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
