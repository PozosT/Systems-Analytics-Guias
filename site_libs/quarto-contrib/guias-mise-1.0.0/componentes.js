// componentes.js — Interactividad de las guías de autoestudio.
//
// Mejora progresiva: sin JavaScript, todos los pasos y todas las
// explicaciones quedan visibles y la página se lee completa. Con
// JavaScript:
//   .pasos > .paso          visor paso a paso con Anterior/Siguiente
//   .quiz > .opcion         pregunta con retroalimentación inmediata
//   .prediccion > .opcion   predicción que se guarda y se recuerda después
//   .mi-prediccion[data-para]  muestra la predicción guardada
(function () {
  "use strict";

  const guardar = (clave, valor) => {
    try { window.localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ }
  };
  const leer = (clave) => {
    try { return window.localStorage.getItem(clave); } catch (e) { return null; }
  };
  const boton = (texto, clase, alPulsar) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = clase;
    b.textContent = texto;
    b.addEventListener("click", alPulsar);
    return b;
  };

  // ------------------------------------------------------------------
  // Visor paso a paso
  // ------------------------------------------------------------------
  function iniciarPasos(contenedor) {
    const pasos = Array.from(contenedor.children).filter((n) => n.classList.contains("paso"));
    if (pasos.length < 2) return;
    contenedor.classList.add("pasos-activo");
    let actual = 0;
    let todos = false;

    const barra = document.createElement("div");
    barra.className = "pasos-barra";
    const puntos = document.createElement("div");
    puntos.className = "pasos-puntos";
    const marcas = pasos.map((_, i) => {
      const m = boton("", "pasos-punto", () => ir(i));
      m.setAttribute("aria-label", `Ir al paso ${i + 1}`);
      puntos.appendChild(m);
      return m;
    });
    const contador = document.createElement("span");
    contador.className = "pasos-contador";
    contador.setAttribute("aria-live", "polite");
    const anterior = boton("◀ Anterior", "pasos-boton", () => ir(actual - 1));
    const siguiente = boton("Siguiente ▶", "pasos-boton pasos-principal", () => ir(actual + 1));
    const verTodos = boton("Ver todos los pasos", "pasos-todos", () => {
      todos = !todos;
      actualizar();
    });

    const navegacion = document.createElement("div");
    navegacion.className = "pasos-navegacion";
    navegacion.append(anterior, contador, siguiente);
    barra.append(puntos, navegacion, verTodos);
    contenedor.appendChild(barra);

    contenedor.addEventListener("keydown", (evento) => {
      if (evento.target.closest("input, textarea, select")) return;
      if (evento.key === "ArrowRight") { ir(actual + 1); evento.preventDefault(); }
      if (evento.key === "ArrowLeft") { ir(actual - 1); evento.preventDefault(); }
    });

    function ir(i) {
      actual = Math.max(0, Math.min(pasos.length - 1, i));
      todos = false;
      actualizar();
    }
    function actualizar() {
      pasos.forEach((p, j) => {
        p.hidden = !todos && j !== actual;
        p.classList.toggle("paso-actual", j === actual);
        p.setAttribute("data-numero", `Paso ${j + 1} de ${pasos.length}`);
      });
      marcas.forEach((m, j) => {
        m.classList.toggle("visto", j < actual);
        m.classList.toggle("actual", j === actual);
      });
      contador.textContent = todos ? `${pasos.length} pasos` : `Paso ${actual + 1} de ${pasos.length}`;
      anterior.disabled = todos || actual === 0;
      siguiente.disabled = todos || actual === pasos.length - 1;
      navegacion.hidden = todos;
      puntos.hidden = todos;
      verTodos.textContent = todos ? "Volver al modo paso a paso" : "Ver todos los pasos";
      contenedor.classList.toggle("pasos-todos-visibles", todos);
      // Las gráficas que dependen del ancho se recalculan al mostrarse
      window.dispatchEvent(new Event("resize"));
    }
    actualizar();
  }

  // ------------------------------------------------------------------
  // Preguntas y predicciones
  // ------------------------------------------------------------------
  function textoOpcion(opcion) {
    const copia = opcion.cloneNode(true);
    copia.querySelectorAll(".porque, .opcion-letra").forEach((n) => n.remove());
    return copia.textContent.trim().replace(/\s+/g, " ");
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
    const opciones = Array.from(caja.children).filter((n) => n.classList.contains("opcion"));
    if (opciones.length === 0) return;
    const explicacion = Array.from(caja.children).find((n) => n.classList.contains("explicacion"));
    const aviso = document.createElement("p");
    aviso.className = "quiz-aviso";
    aviso.setAttribute("aria-live", "polite");
    caja.appendChild(aviso);
    caja.classList.add("quiz-activo");
    if (explicacion) explicacion.hidden = true;

    opciones.forEach((opcion, i) => {
      const letra = document.createElement("span");
      letra.className = "opcion-letra";
      letra.textContent = String.fromCharCode(65 + i);
      opcion.prepend(letra);
      opcion.setAttribute("role", "button");
      opcion.tabIndex = 0;
      opcion.querySelectorAll(".porque").forEach((p) => { p.hidden = true; });
      opcion.addEventListener("click", () => elegir(i));
      opcion.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter" || evento.key === " ") { elegir(i); evento.preventDefault(); }
      });
    });

    function elegir(i) {
      opciones.forEach((o) => {
        o.classList.remove("elegida", "acierto", "fallo");
        o.querySelectorAll(".porque").forEach((p) => { p.hidden = true; });
      });
      const opcion = opciones[i];
      opcion.classList.add("elegida");
      opcion.querySelectorAll(".porque").forEach((p) => { p.hidden = false; });

      if (esPrediccion) {
        const letra = String.fromCharCode(65 + i);
        if (caja.id) {
          guardar(`guias-mise:prediccion:${caja.id}`, `${letra}. ${textoOpcion(opcion)}`);
          mostrarPredicciones();
        }
        aviso.textContent = "Predicción anotada. Siga leyendo: más adelante la comprobará con el simulador.";
        return;
      }
      const correcta = opcion.dataset.correcta === "si";
      opcion.classList.add(correcta ? "acierto" : "fallo");
      aviso.textContent = correcta ? "Correcto." : "Todavía no. Lea la pista y vuelva a intentarlo.";
      if (explicacion) explicacion.hidden = !correcta;
    }
  }

  function mostrarPredicciones() {
    document.querySelectorAll(".mi-prediccion[data-para]").forEach((marca) => {
      const guardada = leer(`guias-mise:prediccion:${marca.dataset.para}`);
      marca.textContent = guardada ? `«${guardada}»` : "(aún no ha registrado una predicción)";
    });
  }

  function iniciar() {
    document.querySelectorAll(".pasos").forEach(iniciarPasos);
    document.querySelectorAll(".quiz, .prediccion").forEach(iniciarPregunta);
    mostrarPredicciones();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
