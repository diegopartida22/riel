import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

/* El menú del navegador —«Recargar», «Inspeccionar elemento», «Atrás»— es el rastro de página
   que menos se perdona: aparece con el gesto más común de macOS y nombra cosas que en esta app
   no existen. Se apaga en todas partes menos donde se escribe: sobre un campo, el menú que da
   WKWebView es el de texto del sistema —cortar, copiar, pegar, ortografía— y ese sí se espera.
   El menú del `⋯` de una fila es lo que sustituye al de la lista (spec 3.5). */
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea")) return;
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
