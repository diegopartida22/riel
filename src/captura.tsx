import React from "react";
import ReactDOM from "react-dom/client";

import { QuickCapture } from "./ui/QuickCapture";
import "./captura.css";

/* Lo mismo que en el panel, y por lo mismo (spec 3.10): el menú del navegador nombra cosas que
   aquí no existen, y sobre un campo el que da WKWebView es el de texto del sistema, que sí se
   espera. En esta ventana casi todo es campo — razón de más para no apagarlo donde toca. */
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea")) return;
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QuickCapture />
  </React.StrictMode>,
);
