import { useEffect } from "react";

/**
 * Marca el documento mientras se navega con el teclado.
 *
 * La sección 5 pide un anillo de foco visible siempre, y `:focus-visible` por sí solo no lo
 * da. El recorrido de la lista no mueve el foco con el Tab: cada flecha llama a `focus()`
 * desde el manejador, y para un foco puesto desde código la especificación dice que el
 * elemento nuevo solo se considera visible si lo era el anterior. Basta con que la cadena
 * arranque de un sitio que no lo era —el `body` tras un clic en el hueco de la lista, o la
 * fila que hereda el foco cuando la de arriba colapsa al completarse— para que el anillo
 * desaparezca y ya no vuelva por más flechas que se pulsen. Medido en el panel: tras
 * completar una fila con Espacio, ↑ y ↓ seguían moviendo el foco —⏎ abría la edición de la
 * fila correcta— pero sin pintar nada.
 *
 * `focus({ focusVisible: true })` sería lo exacto, pero su soporte no está en todas las
 * versiones de WebKit que puede traer un macOS y un anillo que se pierde según la versión del
 * sistema no es un anillo. Así que la modalidad se lleva a mano: mientras la última
 * interacción sea de teclado, el foco se pinta con `:focus` a secas; en cuanto el ratón toca
 * algo, se vuelve a `:focus-visible` y las filas quedan limpias al hacer clic.
 */
const NAVEGACION = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Enter",
  "Escape",
  " ",
]);

export function useFocoDeTeclado() {
  useEffect(() => {
    const root = document.documentElement;

    const teclado = (event: globalThis.KeyboardEvent) => {
      // Escribir no es navegar: una letra en el campo de captura no tiene por qué encender
      // anillos en el resto del panel.
      if (!NAVEGACION.has(event.key)) return;
      root.dataset.teclado = "";
    };

    const raton = () => {
      delete root.dataset.teclado;
    };

    // En captura: si algo detiene la propagación —un menú, el editor en línea— la modalidad
    // se enteraría igual, que es lo único que aquí importa.
    document.addEventListener("keydown", teclado, true);
    document.addEventListener("pointerdown", raton, true);
    return () => {
      document.removeEventListener("keydown", teclado, true);
      document.removeEventListener("pointerdown", raton, true);
    };
  }, []);
}
