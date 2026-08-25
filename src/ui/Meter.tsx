/**
 * Una barra de magnitud: la pista y lo lleno.
 *
 * Es el primitivo de «dato con forma» de la app y va con las reglas de la sección 3: un solo
 * color, el acento —el de la app y no el del proyecto que se esté mirando, porque donde se usa
 * no es de ningún proyecto (spec 3.1)— sobre la misma pista con alfa que un segmentado de
 * Ajustes. Sin gradientes, sin sombras y sin un hex escrito a mano.
 *
 * Y sin animación de llenado. El valor solo cambia al releer, así que la transición no
 * acompañaría a un gesto de nadie: sería movimiento porque sí, que es lo que el criterio 7
 * apaga aunque no se lo pidan.
 *
 * Va `aria-hidden`: la cifra que la acompaña dice lo mismo y con precisión, y anunciar las dos
 * es leer el dato dos veces. Quien la use tiene que ponerle esa cifra al lado.
 */
export function Meter({ fill }: { fill: number }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  return (
    <span className="meter" aria-hidden>
      <span className="meter__fill" style={{ width: `${clamped * 100}%` }} />
    </span>
  );
}
