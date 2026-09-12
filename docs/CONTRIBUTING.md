# Contribuir a PANGEA

Esta guía está escrita para que una persona que nunca ha visto este repositorio
pueda hacer una contribución correcta sin preguntarle nada a nadie.

No hace falta que sepas nada de PANGEA de antemano. Sí hace falta que respetes
lo que ya existe: casi todas las reglas de este documento no son preferencias de
estilo, son consecuencias de las promesas que el proyecto hace en su README.

---

## 1. Qué es PANGEA y qué no es

PANGEA **no es una red social, ni un foro, ni un chat**. No hay perfiles que
seguir, ni muro, ni mensajes privados, ni notificaciones diseñadas para que
vuelvas.

PANGEA es una **capa de coordinación**: conecta a quien tiene un problema con
quien tiene la solución, aunque hablen idiomas distintos y vivan en continentes
distintos. Se ejecuta entera dentro del navegador de cada persona, sin
servidores, sin cuentas y sin conexión obligatoria.

Cada cambio que entra en este repositorio tiene que responder a una sola
pregunta:

> **¿Esto ayuda a que dos personas que no se conocen, que hablan idiomas
> distintos y viven en continentes distintos, puedan colaborar en 60 segundos
> para resolver un problema real?**

Si la respuesta es no, el cambio puede ser correcto, útil y elegante, y aun así
no pertenece a PANGEA. Si la respuesta es «sí, pero dentro de dos años», abre
una propuesta antes de escribir el código.

---

## 2. Puesta en marcha en 60 segundos

**Requisito único:** Node.js 20 o superior. Nada más.

```bash
git clone <URL-del-repositorio>
cd PANGEA

npm start                 # equivale a: node tools/serve.mjs
# o, sin npm:
node tools/serve.mjs
```

Abre **http://127.0.0.1:8188** en el navegador.

### Tres cosas que conviene entender de este arranque

**1. No hay nada que instalar.** `dependencies` y `devDependencies` están vacíos
en `package.json`. `npm install` no hace falta **nunca**, ni una sola vez;
`package.json` existe solo para declarar que el proyecto es ESM
(`"type": "module"`), habilitar `node --check` sobre los fuentes y exponer los
comandos de servidor y auditoría. Todo el código es JavaScript nativo de
navegador.

**2. No hacen falta HTTPS ni certificados.** `127.0.0.1` cuenta como *origen
seguro* para los navegadores, así que el Service Worker, la Web Crypto y la
geolocalización funcionan en desarrollo sin configurar nada. En un despliegue
real sí necesitas HTTPS: cualquier alojamiento estático moderno lo da gratis.

**3. El servidor es una herramienta de desarrollo.** `tools/serve.mjs` sirve
archivos estáticos con los tipos MIME correctos para `.mjs`, `.woff2` y
`.webmanifest`, envía `Cache-Control: no-cache` en `service-worker.js`,
`index.html` y `manifest.json` (para que las actualizaciones se detecten), y
bloquea cualquier ruta que salga del proyecto. En producción sirve cualquier
servidor estático con las mismas dos reglas.

### La prueba que de verdad importa

1. Abre la aplicación en el navegador.
2. Instálala con el icono de instalación de la barra de direcciones.
3. **Activa el modo avión.**
4. Recarga la página.

Debe seguir funcionando: los siete módulos, la búsqueda, el archivo local y
hasta la traducción de frases de emergencia. Si tu cambio rompe esto, tu cambio
no está listo, por muy bien que se vea con conexión.

La primera vez verás un onboarding de siete pasos y, al cerrarlo, te ofrecerá
crear tu identidad NEXUS. Los datos de arranque (6 problemas, 7 capacidades,
5 saberes, 3 afirmaciones y 8 palabras) son **ilustrativos** y la interfaz los
marca como *Demostración*: no los tomes como referencia real.

### Otros comandos disponibles

| Comando | Qué hace |
|---|---|
| `npm start` · `npm run serve` | Servidor local en el puerto 8188 (`--port`, `--host`) |
| `npm run audit` · `npm run check` | Auditoría estática; sale con código 0 si todo está bien |
| `npm run assets` | Regenera iconos PNG, aviso sonoro y tipografía auto-alojada |
| `node tools/e2e.mjs` | Prueba en un navegador real. **No tiene script npm**: se ejecuta directamente |

---

## 3. Los cinco principios que ninguna contribución puede romper

### 3.1 Local-first: el dispositivo es la fuente de verdad

No existe «la nube» a la que enviar los datos del usuario. IndexedDB es la
fuente primaria.

**Regla concreta:** ningún módulo puede necesitar una petición de red para
montarse ni para mostrar datos. Se lee de `Store` y, si acaso, se refresca
después. Toda escritura pasa por `ctx.publish` o por `Store`, nunca por una API
propia del módulo.

### 3.2 Sin conexión por defecto

El modo sin conexión no es un estado de error: es el estado normal. El Service
Worker precarga el armazón y aplica cuatro estrategias distintas según el tipo
de petición.

**Regla concreta:** si añades un archivo (JavaScript, CSS, datos, icono, audio),
tienes que añadirlo también a la lista `SHELL` de `service-worker.js`. La
auditoría lo comprueba en las **dos** direcciones desde el bloque *Entrega sin
conexión*: que todo lo listado exista y que **todo** archivo de ejecución de
`js`, `css`, `data` y `assets` esté listado. Un módulo nuevo que se quede fuera
de `SHELL` ya no pasa la auditoría. Si añades una llamada a `fetch`, tienes que
tener una respuesta local para cuando falle.

### 3.3 Cero servidores, cero cuentas, cero rastreadores

No hay registro, no hay analítica, no hay peticiones que el usuario no provoque.

**Regla concreta:** no añadas analítica, ni fuentes de Google, ni scripts de
terceros sin detectarlos en tiempo de ejecución y sin una ruta local que siga
funcionando. Las únicas bibliotecas externas que el proyecto carga hoy son las
tres opcionales de `index.html` (Leaflet, Chart.js, MiniSearch) más MediaPipe y
transformers.js cuando un módulo los pide explícitamente. Ninguna es
obligatoria. La telemetría existe, es **local**, el usuario puede verla y
borrarla desde Ajustes, y no se envía a ninguna parte.

### 3.4 Degradación elegante para toda dependencia externa

Cada dependencia se detecta en tiempo de ejecución y su ausencia nunca rompe la
aplicación. No es una aspiración: está implementado.

| Dependencia | Qué pasa si no está |
|---|---|
| Chart.js | El panel de mando sustituye el gráfico por un aviso (`window.Chart && !state.lite`) |
| Leaflet | SOS cae a una lista ordenada por distancia calculada localmente |
| MiniSearch | MEMORIA usa un índice propio TF·IDF con prefijo y realce de título |
| API pública de traducción | LINGUA prueba el nodo propio y luego el fraseo local |
| Nodo LibreTranslate | El fraseo de emergencia local traduce 14 frases en 12 idiomas sin red |
| transformers.js (MiniLM) | `Engine` cae a embeddings locales por n-gramas (hashing trick) |
| MediaPipe Hands | La pestaña de señas avisa y el resto de LINGUA sigue funcionando |
| SpeechRecognition / SpeechSynthesis | El texto sigue funcionando; solo se pierde la voz |

**Regla concreta:** toda dependencia externa va dentro de un `try`, se comprueba
su existencia antes de usarla y existe un modo local documentado. Un
`console.error` en la consola es un fallo, no una advertencia: la prueba E2E
falla si aparece cualquiera.

### 3.5 Funciona en un teléfono de 20 dólares

Sin frameworks, sin paso de compilación, sin dependencias.

**Regla concreta:** nada de bucles pesados ni de cálculos por fotograma que no
se puedan parar; respeta `ctx.state.lite`; mide el tiempo de montaje de tu
módulo (la prueba E2E mide el de las nueve rutas) y no lo empeores sin motivo.

---

## 4. Arquitectura en una página

```
index.html · manifest.json · service-worker.js          ← armazón y entrega
        │
        ▼
js/app.js   ── ctx (contexto compartido), router por hash, navegación,
        │      onboarding, panel de mando, ajustes, notificaciones, modales
        ▼
js/modules/  lingua · synapse · veritas · memoria · sos · agente · nexus-id
        │
        ▼
núcleo compartido
  store.js    IndexedDB + bus de eventos pub/sub + exportar/importar
  crypto.js   ECDSA P-256, huellas PAN-XXXX-XXXX-XXXX, firmas, identidad cifrada
  engine.js   motor semántico de dos niveles (neural → local) con degradación
  i18n.js     8 idiomas × 502 claves, RTL, carga diferida, respaldo es→en→clave
  utils.js    hyperscript h(), iconos SVG, ZIP propio, embeddings, geolocalización
        │
        ▼
APIs del navegador: IndexedDB · Web Crypto · Speech · MediaRecorder · File · Geolocation
```

### El contrato de módulo

Todo módulo exporta por defecto exactamente esto:

```js
export default {
  id,        // identificador; debe coincidir con el nombre del archivo
  icon,      // clave de ICON_PATHS en utils.js
  accent,    // indigo · cyan · emerald · amber · red
  titleKey,  // clave de i18n del título
  subKey,    // clave de i18n del subtítulo
  async mount(root, ctx) { /* ... */ return cleanup },
};
```

- `mount` construye la interfaz **dentro** de `root` y devuelve una función de
  limpieza.
- `ctx` es el contexto compartido: traducción (`ctx.t`), hiperscript (`ctx.h`),
  iconos (`ctx.icon`), almacén (`ctx.Store`), colecciones (`ctx.COLLECTIONS`),
  identidad (`ctx.Crypto`, `ctx.author`, `ctx.requireIdentity`), motor semántico
  (`ctx.Engine`), router (`ctx.navigate`), avisos (`ctx.toast`), modales
  (`ctx.openModal`, `ctx.confirm`, `ctx.ask`), taxonomía
  (`ctx.categories`, `ctx.catLabel`, `ctx.catColor`, `ctx.catIcon`), autoría
  (`ctx.publish`), verificación (`ctx.verifyRecord`), reputación
  (`ctx.awardPoints`, `ctx.points`) y utilidades (`ctx.U`).
- **Ningún módulo importa `../app.js`.** Eso crearía una dependencia circular y
  la auditoría lo rechaza de forma explícita.

### Detalles que se descubren tarde

- `ROUTES` se deriva de `MODULES`, así que registrar un módulo lo hace navegable
  sin tocar el router.
- **El orden de `MODULES` define el orden de la navegación y los atajos de
  teclado `1`…`N`.** Insertar un módulo en medio desplaza los atajos de todos
  los siguientes.
- La barra inferior del móvil **no** se genera desde `MODULES`: usa la lista
  fija `NAV_PRIMARY` (`home`, `lingua`, `synapse`, `veritas`, `memoria`, `sos`)
  más `agente`, y cada etiqueta se abrevia con `shortLabel()` —la primera palabra,
  no un corte a mitad de palabra—. Si quieres que tu módulo esté ahí, edita esa
  lista a mano: aparecerá en la barra lateral, pero no en la barra del móvil.
- Al cambiar de ruta, `app.js` ejecuta la limpieza del módulo anterior **antes**
  de montar el siguiente. Si tu limpieza no cancela todo, quedan escuchas
  vivas de una vista que ya no existe.

---

## 5. Cómo crear un módulo nuevo

### 5.1 Esqueleto completo y copiable

Crea `js/modules/taller.js` con este contenido y adáptalo. Está comentado en
español a propósito: cada comentario señala una trampa real.

```js
/* ============================================================================
 * PANGEA · js/modules/taller.js
 * TALLER — plantilla mínima que respeta el contrato de módulo.
 * ==========================================================================*/

/* Un módulo importa EXACTAMENTE tres archivos del núcleo compartido. No importa
 * ../app.js (crearía una dependencia circular, y la auditoría lo rechaza) ni
 * otros módulos: todo lo demás llega por el objeto `ctx` de mount(). */
import { h, icon, scope, clear, fmt, debounce, download } from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

export default {
  id: 'taller',              // debe coincidir con el nombre del archivo
  icon: 'spark',             // una clave de ICON_PATHS (utils.js)
  accent: 'cyan',            // indigo · cyan · emerald · amber · red
  titleKey: 'taller.title',  // debe existir en los 8 archivos de locales/
  subKey: 'taller.sub',

  async mount(root, ctx) {
    /* 1. `scope` agrupa listeners, temporizadores y observadores para poder
     *    cancelarlos de golpe en la limpieza. */
    const s = scope(root);
    const view = h('div.view');
    root.append(view);

    const state = { query: '' };

    /* 2. Suscripción al almacén. Devuelve su propia función de baja: guárdala. */
    const unsubs = [ctx.onStore(COLLECTIONS.knowledge, () => paint())];

    /* 3. Las tres formas de h() que usa todo el proyecto:
     *    a) con objeto de propiedades .... h('input.input', { type: 'search' })
     *    b) con un hijo directo .......... h('div.card', h('div.card-body'))
     *    c) con una cadena de texto ...... h('span.tile-name', 'PANGEA')
     *
     * h(tag, props, ...children) decide qué es cada cosa: `isChildLike()` en
     * utils.js comprueba si el segundo argumento es un hijo —un Node, un array,
     * una cadena, un número, un booleano, null o undefined— y, cuando lo es, lo
     * reinserta como PRIMER HIJO en lugar de tratarlo como propiedades. Por eso
     * h('div.card', 'Hola') escribe el texto «Hola» y no intenta aplicar los
     * atributos de una cadena. La consecuencia práctica: un objeto de
     * propiedades nunca puede ser una cadena, y si necesitas pasar
     * propiedades Y un hijo, van en ese orden — h('div.card', { class: 'x' }, hijo).
     *
     * (Nota histórica: esto fue un defecto real y merece recordarse. Antes,
     * h('div.card', hijo) interpretaba el nodo como objeto de propiedades, no
     * encontraba ningún atributo que aplicar y el hijo desaparecía SIN NINGÚN
     * ERROR: la interfaz quedaba a medias y no había nada en la consola que
     * explicara por qué. Es el tipo de regresión que no se ve en una captura de
     * pantalla ni en una revisión rápida. Si tocas `h()` o `isChildLike()`, la
     * prueba de extremo a extremo es la red que la detecta.) */

    /* 4. Entrada de texto: siempre con debounce. Repintar en cada tecla
     *    desperdicia el dispositivo y hace parpadear el foco. */
    const repaint = debounce(() => paint(), 220);

    function card(rec) {
      /* Un elemento de tarjeta que se comporta como botón: rol, tabindex,
       * teclado y nombre accesible. Es el mismo patrón que usan las tarjetas
       * del Kanban de SYNAPSE. */
      return h('article.card.interactive', {
        role: 'button', tabindex: '0',
        'aria-label': `${ctx.t('action.view')}: ${rec.title}`,
        onclick: () => detalle(rec),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); detalle(rec); }
        },
      },
        h('div.card-body.stack.sm',
          h('h3.know-title', { text: rec.title }),                    // forma (a)
          h('p.sm.dim.clamp-2', { text: fmt.trunc(rec.body || '', 160) }),
          h('div.row.gap-2.tiny.dim',
            icon('clock', 12),
            h('span', fmt.rel(rec.createdAt, ctx.I18n.lang)),          // forma (c)
            h('span', { text: rec.author?.name || '—' }),              // forma (a)
          ),
        ),
      );
    }

    async function paint() {
      clear(view);

      view.append(h('div.view-header',
        h('div.view-heading',
          h('h1.view-title', icon('spark', 26), ctx.t('taller.title')),
          h('p.view-sub', { text: ctx.t('taller.sub') }),
        ),
        h('div.view-actions',
          h('button.btn.primary', { onclick: () => publicar() },
            icon('plus', 17), ctx.t('action.add')),
        ),
      ));

      const rows = (await Store.sorted(COLLECTIONS.knowledge, 'desc'))
        .filter((r) => `${r.title} ${r.body || ''}`.toLowerCase().includes(state.query.toLowerCase()));

      view.append(h('div.mt-4',
        h('div.search-box',
          icon('search', 17),
          h('input.input', {
            type: 'search', value: state.query,
            placeholder: ctx.t('action.search'),
            'aria-label': ctx.t('action.search'),          // nombre accesible obligatorio
            oninput: (e) => { state.query = e.target.value; repaint(); },
          }),
        ),
        rows.length
          ? h('div.grid.grid-auto.wide.mt-4', ...rows.map(card))
          : h('div.empty.mt-4', icon('book', 30),
              h('div.empty-title', { text: ctx.t('state.empty') })),
        h('div.row.gap-2.wrap.mt-4',
          h('button.btn.sm', { onclick: () => exportar(rows) },
            icon('download', 15), ctx.t('action.export')),
        ),
      ));
    }

    async function publicar() {
      /* 5. Publicar SIEMPRE por ctx.publish: genera id y createdAt, añade
       *    `author`, firma (si hay identidad) y guarda. */
      const texto = await ctx.ask({
        title: ctx.t('action.add'), label: ctx.t('field.title'),
        placeholder: ctx.t('field.title'),
      });
      if (!texto) return;

      const rec = await ctx.publish(COLLECTIONS.knowledge, {
        title: texto, body: '', kind: 'nota',
      });
      ctx.toast(ctx.t('toast.published'), 'ok');
      await Store.log('taller', texto, { id: rec.id });   // aparece en la actividad del panel
    }

    /* 6. Paquete firmado propio del módulo, como hacen SOS, MEMORIA y LINGUA.
     *    Aquí sí se usa `Crypto` directamente, porque esto no es un registro de
     *    una colección sino un archivo que va a viajar a otro dispositivo. */
    async function exportar(rows) {
      if (!rows.length) { ctx.toast(ctx.t('state.empty'), 'warn'); return; }
      const autor = await ctx.author();
      const paquete = {
        format: 'pangea-taller', spec: '1.0',
        exportedAt: new Date().toISOString(),
        records: rows,
      };
      const firmado = autor.anon ? paquete : await Crypto.signed(paquete);
      download(`pangea-taller-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(firmado, null, 2), 'application/json');
      ctx.toast(ctx.t('toast.exported'), 'ok');
    }

    await paint();

    /* 7. La limpieza es obligatoria y debe cubrir TODO lo que hayas abierto:
     *    suscripciones, timers, cámara, micrófono, mapas, workers. */
    return () => {
      unsubs.forEach((u) => { try { u(); } catch {} });
      s.destroy();   // aborta listeners, temporizadores y observadores del scope
    };
  },
};
```

Notas sobre lo que hace este esqueleto:

- `ctx.ask` y `ctx.openModal` ya gestionan foco, `Escape` y `role="dialog"`.
  No escribas tus propios modales.
- `ctx.t(...)` es la traducción. Nunca escribas texto visible en español
  directamente en el código.
- `ctx.author()` devuelve `{ fingerprint, name, anon }` y se usa, por ejemplo,
  para añadir colaboradores a una tarjeta.
- `Crypto` se importa para firmar o verificar cosas que no van a una colección
  (como el paquete de SOS); para registros guardados, `ctx.publish` ya firma.

### 5.2 Los pasos de registro

Un módulo que no se registra no existe. Son **cinco pasos obligatorios**; la
auditoría comprueba cuatro de ellos —el nombre y el `id`, la importación, las
claves de idioma y la lista `SHELL`—, pero **no** el paso 3: si te olvidas de
añadirlo a `MODULES`, el módulo se importa y no aparece en ninguna parte, sin
ningún error que lo delate. Los cinco pasos, en orden:

1. **Crea el archivo** en `js/modules/`. El nombre del archivo determina el `id`
   (la auditoría lo comprueba). La única excepción documentada en todo el
   proyecto es `nexus-id.js`, cuyo `id` es `nexus`.
2. **Impórtalo en `js/app.js`**, junto a los demás módulos. La auditoría
   comprueba que todo lo importado por `app.js` exista en disco.
3. **Añádelo al arreglo `MODULES`** de `js/app.js`. La posición decide el orden
   de navegación y los atajos `1`…`N`.
4. **Añade su `titleKey` y su `subKey` a los ocho archivos de `js/locales/`**
   (`es`, `en`, `pt`, `fr`, `ar`, `hi`, `zh`, `ru`) en el mismo pull request. Si
   falta en uno solo, la auditoría falla.
5. **Añade la ruta de tu archivo a la lista `SHELL` de `service-worker.js`.**
   Esto **ya no es una recomendación que el sistema no te recuerda**: la
   comprobación *Cobertura del precache* recorre `js/`, `css/`, `data/` y
   `assets/` y **falla** si algún archivo de ejecución no está en la lista del
   Service Worker, así que un módulo ausente de `SHELL` rompe la auditoría. Sin
   este paso el módulo solo aparecería tras una primera visita con conexión: la
   primera sesión sin conexión no lo tendría.

Opcional, y **no** se deduce de `MODULES`: la barra inferior del móvil usa la
lista fija `NAV_PRIMARY` de `js/app.js` (más `agente`). Tu módulo aparecerá en la
barra lateral por el paso 3, pero **no** en la barra inferior del móvil salvo que
añadas su `id` a `NAV_PRIMARY`.

---

## 6. Reglas de la interfaz

**Reutiliza las clases existentes.** La biblioteca está en `css/components.css`
y está indexada por grupos:

| Grupo | Clases |
|---|---|
| Layout | `.row` `.col` `.stack` `.grid` `.grid-2/3/4` `.grid-auto[.wide/.narrow]` `.between` `.wrap` `.grow` `.gap-1…6` `.mt-*` `.mb-*` |
| Encabezado de vista | `.view-header` `.view-heading` `.view-title` `.view-sub` `.view-actions` `.section-title` |
| Tarjetas | `.card[.interactive/.flat/.aurora/.danger/.warn/.ok/.info]` `.card-head` `.card-body[.tight/.flush]` `.card-foot` `.stat` `.stat-value` `.stat-label` |
| Botones | `.btn` + `.primary` `.aurora` `.secondary` `.success` `.danger` `.warn` `.ghost` `.link` + `.sm` `.lg` `.icon` `.block` `.fab` `.btn-group` |
| Formularios | `.field` `.label[.req/.opt]` `.input` `.textarea[.tall]` `.select` `.input-group` `.hint` `.form-grid` `.switch` `.checkline` `.char-count` `.dropzone` |
| Chips y estados | `.chip[.static/.active]` `.cat-dot` `.badge[.ok/.warn/.danger/.info/.primary/.mono]` `.dot` `.chips` |
| Navegación secundaria | `.tabs` `.tab[.active]` `.count` `.segmented` |
| Kanban | `.kanban` `.kanban-col` `.kanban-head` `.kanban-body` `.kcard` `.kcard-title` `.kcard-meta` |
| Listas y tablas | `.list` `.list-item[.clickable]` `.table` `.table-wrap` `.kv` |
| Modales y avisos | `.modal*` `.banner[.warn/.danger/.ok]` `.toast` |
| Estados | `.empty` `.empty-title` `.empty-body` `.skeleton` `.spinner[.sm/.lg]` `.progress` `.meter` |
| Extras | `.avatar` `.sig[.valid/.invalid]` `.seal[.low/.bad]` `.sig-block` `.timeline` `.ratio-ring` |

Y los helpers tipográficos de `css/base.css`: `.sm` `.tiny` `.dim` `.mono`
`.upper` `.bold` `.clamp-2` `.clamp-3`.

`css/modules.css` contiene los componentes específicos de cada módulo
(`.hero`, `.module-tile`, `.translate-grid`, `.pane`, `.bubble`, `.vocab-card`,
`.know-card`, `.claim-card`, `.vote-btn`, `.alert-card`, `.map-shell`,
`.rule-row`, `.id-hero`, `.onboard`, `.install-prompt`…). Si tu módulo necesita
un componente visual nuevo y reutilizable, propónlo en una incidencia y añádelo
a `components.css` usando los tokens existentes (`--sp-*`, `--r-*`, `--fs-*`,
`--dur-*`, `--surface`, `--border`, `--text-*`, `--primary`…), de modo que
funcione en tema claro, en oscuro y con `prefers-contrast: more`.

Las reglas, en corto:

1. **No añadas archivos CSS.** El armazón carga exactamente cinco hojas
   —`fonts.css`, `base.css`, `layout.css`, `components.css`, `modules.css`— y
   están en la lista `SHELL` del Service Worker. Un archivo nuevo obligaría a
   tocar las dos cosas y a justificarlo.
2. **Estilos en línea solo para valores que vienen de los datos.** Es lo que ya
   hace el proyecto: el color de una categoría
   (`style: 'background:' + ctx.catColor(id)` en el punto de categoría), el
   ancho de una barra de progreso (`width:${clamp(pct, 2, 100)}%`), el degradado
   determinista del avatar a partir de la huella, o el tamaño de un lienzo. Un
   color fijo, un margen o una tipografía nunca van en línea: van en la clase.
3. **Ningún framework.** Sin React, Vue, Svelte, jQuery, Tailwind ni paso de
   compilación. La interfaz se construye con `h()` y con las clases de arriba.
4. **Elementos semánticos primero.** `main`, `nav`, `section`, `article`,
   `button`, `label`, `table`. Un `<div>` solo cuando no existe nada mejor. Para
   una tarjeta entera que se comporta como botón, usa el patrón de SYNAPSE:
   `role="button"`, `tabindex="0"`, manejo de `Enter` y `Espacio` y un nombre
   accesible.
5. **Todo control interactivo tiene nombre accesible.** Un botón con solo un
   icono necesita `aria-label` (mira `ctx.t('a11y.closeModal')` en los modales).
   Nunca dejes un botón de icono sin nombre.

---

## 7. Reglas de datos y criptografía

### 7.1 Nunca escribas en IndexedDB directamente si `ctx.publish` encaja

`ctx.publish` es el camino normal de cualquier contribución del usuario. Hace
cinco cosas que un `Store.put` a mano no hace: genera identificador y fecha,
añade la autoría normalizada, firma el registro, respeta el idioma activo y
emite el evento que refresca la interfaz.

```js
const rec = await ctx.publish(COLLECTIONS.vocab, { word, meaning, lang });
```

`Store.put` directo se reserva para datos internos (semilla, telemetría,
identidad); `Store.patch` se usa para cambiar el estado de un registro que ya
existe.

### 7.2 Todo registro lleva autoría y sobre de firma

La auditoría no lo comprueba, pero el resto del sistema sí lo espera:

- `author`: `{ fingerprint, name, anon }`. Lo pone `ctx.publish`.
- `sig`: el sobre `{ sig, pub, fp, alg, at }` que produce `Crypto.signed`.

`Crypto.verify()` hace **dos** comprobaciones, y la segunda es tan importante
como la primera: **(1)** que la firma sea matemáticamente válida para la clave
pública del sobre (`sig.pub`), y **(2)** que la huella declarada en `sig.fp`,
**cuando viene**, sea exactamente la que se deriva de esa misma clave pública. Si
no coincide, `verify()` devuelve `false`. Sin la segunda comprobación, cualquiera
podría firmar con su propia clave y escribir en el sobre la huella de otra
persona: la firma validaría y la interfaz mostraría un autor que no es el
firmante. De ahí una regla que no se negocia: **nunca muestres una huella que no
hayas derivado tú mismo de la clave pública que validaste**. Para eso están
`Crypto.signerOf(rec)` —devuelve `{ fingerprint, claimed, spoofed, isSelf, at,
verified }` con la huella recalculada— y `Crypto.verifyAttestation(att)`, que
compara el emisor declarado con quien firmó de verdad.

Ojo con un detalle real: **si no hay identidad NEXUS, `ctx.publish` no firma.**
En ese caso la autoría queda como `{ fingerprint: 'local-anon', name: '—',
anon: true }` y el registro se guarda sin `sig`; `ctx.verifyRecord` lo
etiquetará honestamente como *no verificable*. Si tu módulo necesita registros
firmados, pide la identidad antes:

```js
if (!(await ctx.requireIdentity())) return;   // avisa y no continúa
```

### 7.3 Por qué el identificador y la fecha existen antes de firmar

Este es el fragmento real de `ctx.publish` en `js/app.js`:

```js
const base = {
  id: payload.id || U.uid(String(collection).slice(0, 4)),   // 1
  createdAt: payload.createdAt || Date.now(),                 // 2
  ...payload,
  author,                                                     // 3
  lang: payload.lang || I18n.lang,
};
const signed = author.anon ? base : await Crypto.signed(base); // 4 · se firma `base`
const rec = await Store.put(collection, signed);               // 5 · se guarda
```

Los pasos 1 y 2 ocurren **antes** del 4, y eso importa por una razón práctica:
`Store.put` normaliza el registro con `{ createdAt: Date.now(), ...record }` y
con `rec.id = rec.id || uid(...)`. Es decir, **si el registro ya trae `id` y
`createdAt`, esos valores ganan**; si no los trajera, los inventaría la capa de
almacenamiento. El mismo contenido acabaría con un identificador distinto en cada
dispositivo, y la deduplicación por `id` que usa `Store.importAll` al importar un
pasaporte dejaría de reconocer lo que ya tiene. La identidad del registro la
decide quien lo crea, no quien lo guarda.

Conviene ser exacto sobre el alcance de esto: la firma **no** depende de esos
campos —`canonical()` los excluye, así que un registro firmado sin ellos se
verificaría igual—. Se generan antes de firmar para que el registro tenga
identidad propia y estable desde el primer momento, y para que quien lo guarde no
tenga que inventarla. Es una decisión de diseño, no un requisito criptográfico.

### 7.4 Por qué los campos de ciclo de vida quedan fuera de lo que se firma

La firma acredita la **autoría del contenido**, no la vida posterior del
registro. `crypto.js` construye una proyección canónica (claves ordenadas
recursivamente) y descarta, **en cualquier nivel de profundidad**, estos 20
nombres de campo (`NOT_SIGNED`):

```
sobre de firma ····· sig · signature
almacenamiento ····· id · createdAt · updatedAt
estado y anotaciones status · confirmations · origin · importedFrom · collaborators
                     seed · score · explain · matchedAt · seenBy · curationAvg · curationCount
cachés de cálculo ·· _vec · _score · local
```

Dos de esos nombres merecen un aviso explícito: **`id` y `createdAt` no forman
parte de lo que se firma.** Que `ctx.publish` los genere antes de firmar (§7.3)
es una comodidad de diseño, no una afirmación criptográfica: **no razones sobre
la firma como si cubriera el identificador o la fecha del registro**, porque no
los cubre. Si una implementación ajena los incluyera en su proyección, produciría
una cadena canónica distinta y dejaría de ser interoperable.

Que el conjunto sea **uno solo y recursivo** —y no una lista en la raíz y otra en
los niveles internos— es deliberado: así la proyección es idempotente y un
registro firmado suelto y ese mismo registro dentro de un paquete producen
exactamente la misma cadena canónica. Con dos listas distintas, la proyección
dependería del contexto y dos implementaciones compatibles podrían discrepar.

El motivo de excluirlos es concreto. La comunidad trabaja sobre los registros:
`Store.patch` reescribe el `status` y los `collaborators` de un emparejamiento,
se añaden confirmaciones a una alerta, se cuentan curaciones de un saber, se
reimporta el mismo registro con otro `updatedAt`. **Si esos campos estuvieran
dentro de la proyección firmada, la primera confirmación invalidaría la firma del
autor** y una contribución legítima pasaría a figurar como *no verificable* para
siempre. Excluirlos es lo que permite que un registro firmado hoy siga
verificándose dentro de diez años y después de cualquier número de cambios de
estado. El sobre de firma se excluye por pura necesidad: incluirlo sería
recursivo.

(Nota honesta: `_vec`, `_score` y `local` están reservados para que una caché o
una puntuación calculada después, por el dispositivo, no pueda romper una firma.
Hoy ningún módulo los escribe.)

### 7.5 Nunca pongas secretos en un registro

Los registros se exportan: van dentro del Pasaporte PANGEA (un ZIP con
`manifest.json`, `data.json` y un `README.txt`), en las exportaciones por módulo
(`pangea-sos`, `pangea-memoria`, `pangea-lingua-dictionary`, `pangea-synapse`,
`pangea-veritas-claim`) y en las copias que el usuario comparta. Por tanto:

- Nada de contraseñas, tokens de API, claves ni credenciales dentro de un
  registro. Las preferencias sensibles (por ejemplo, la clave de un verificador
  externo) van en `Store.setKv`, nunca en una colección exportable.
- Nada de datos personales de terceros sin su consentimiento.
- La clave privada solo sale del dispositivo dentro del sobre cifrado
  `PANGEA-ID-1` (PBKDF2-SHA256 con 250 000 iteraciones → AES-GCM-256) y solo si
  el usuario lo pide explícitamente.

Estas reglas las aplica el código, no solo la buena voluntad de quien contribuye:

- **`Store.exportAll()` excluye la colección `identity` por omisión** (solo se
  incluiría con `{ includeIdentity: true }`, que ninguna ruta de la interfaz usa)
  y **filtra `Store.SENSITIVE_SETTINGS`** —`pref.llm.key` y
  `pref.translate.endpoint.token`—, dejando constancia de lo omitido en el campo
  `omitted` del paquete. `Store.NEVER_EXPORTED` (`identity` y `telemetry`) marca
  lo que no se transporta nunca: la telemetría local no sale del dispositivo ni
  dentro de un paquete de datos. Un paquete de datos es un pasaporte pensado para
  compartirse: **no devuelvas la identidad a un paquete «por comodidad»**, porque
  eso convierte cualquier copia de seguridad en una filtración de identidad. La
  clave privada viaja solo por su camino cifrado (`PANGEA-ID-1`).
- **`Store.importAll()` lanza una excepción si `format` no es
  `pangea-exchange`** (un `pangea-sos` colado por la vía genérica saltaría la
  validación de firmas) y **siempre omite la colección `identity`**, aunque venga
  con filas: lo reporta en `identitySkipped`. Cada formato tiene su propio
  importador, que valida las firmas y marca la procedencia; el importador
  genérico informa además de `imported`, `overwritten` y `skipped` por separado,
  porque contar las sobrescrituras como omisiones hacía ilegible cualquier estado
  de sincronización.

### 7.6 Utilidades que ya existen: úsalas

| Necesitas | Usa |
|---|---|
| Guardar una contribución firmada | `ctx.publish(colección, payload)` |
| Cambiar el estado de un registro | `Store.patch(colección, id, patch)` |
| Verificar una firma y mostrar un veredicto legible | `ctx.verifyRecord(rec)` |
| Saber quién firma | `ctx.author()` para el autor actual; `ctx.Crypto.signerOf(rec)` para uno ajeno —recalcula la huella desde `rec.sig.pub` y marca `spoofed` si la declarada no coincide—. Nunca leas `rec.sig.fp` como si fuera el autor |
| Dejar constancia en la actividad del panel | `Store.log(tipo, mensaje, meta)` |
| Otorgar reputación portable | `ctx.awardPoints(puntos, motivo)` |
| Exportar datos | `U.download(nombre, contenido, mime)` o `U.zipSync([…])` |

La forma exacta de un registro, la proyección canónica que se firma, el sobre de
firma y cada paquete de intercambio están normalizados en
`docs/PROTOCOLO-PANGEA.md`: ese documento es el que tiene que cumplir cualquier
implementación ajena a este código, así que si tu módulo inventa un campo, un
formato o una regla de firma nueva, está rompiendo el protocolo.

Sobre el nodo comunitario (el campo de Ajustes y el botón «Sincronizar»): hay
**un solo contrato**, y los dos caminos del código lo cumplen. El botón llama a
`syncNow()`, que envía el paquete con `nodeRequest()`; `nodeRequest()` es quien
**instancia `js/workers/sync.worker.js`**, y el worker implementa exactamente lo
mismo: `POST {nodo}/pangea/sync` para subir, `GET {nodo}/pangea/sync?since=…` para
bajar, `GET {nodo}/pangea/health` para comprobar que responde, con
`Authorization: Bearer {token}` opcional. Ya **no** existe un
`POST {nodo}/pangea/alerts` distinto. El paquete que viaja sale de
`Store.exportAll()`, así que tampoco lleva la identidad ni las preferencias
sensibles. Dicho todo esto: **el servidor no existe** en este repositorio (es un
marcador de posición), PANGEA funciona entero sin él, y si cambias ese camino,
cambia el contrato en el worker en lugar de crear una segunda versión que lo
contradiga.

---

## 8. Internacionalización

El conjunto de claves está **congelado en 502 claves por idioma**, en ocho
idiomas: `es`, `en`, `pt`, `fr`, `ar` (con soporte RTL completo), `hi`, `zh`,
`ru`. `js/locales/es.js` es el diccionario canónico.

**La regla principal: no puedes añadir claves.** La interfaz se construye
reutilizando lo que ya existe. Antes de inventar una clave, busca en:

- `action.*` — 42 claves genéricas: `action.save`, `action.cancel`,
  `action.delete`, `action.edit`, `action.create`, `action.publish`,
  `action.search`, `action.filter`, `action.close`, `action.back`,
  `action.next`, `action.done`, `action.retry`, `action.copy`,
  `action.download`, `action.upload`, `action.export`, `action.import`,
  `action.share`, `action.verify`, `action.add`, `action.remove`,
  `action.refresh`, `action.send`, `action.apply`, `action.reset`,
  `action.view`, `action.open`, `action.install`, `action.confirm`,
  `action.details`, `action.accept`, `action.start`, `action.stop`,
  `action.record`, `action.use`, `action.select`, `action.yes`, `action.no`…
- `state.*` — 17 estados: `state.loading`, `state.empty`, `state.error`,
  `state.offline`, `state.online`, `state.demo`, `state.pending`,
  `state.active`, `state.resolved`, `state.open`, `state.saved`,
  `state.verified`, `state.unverified`, `state.disputed`, `state.working`,
  `state.suggested`…
- `field.*` — 21 campos: `field.title`, `field.description`, `field.category`,
  `field.urgency`, `field.location`, `field.tags`, `field.name`,
  `field.language`, `field.license`, `field.author`, `field.date`,
  `field.notes`, `field.password`, `field.optional`, `field.required`,
  `field.type`, `field.status`, `field.source`, `field.evidence`,
  `field.culture`, `field.contact`…

**Si de verdad no hay ninguna clave que sirva**, el procedimiento es:

1. Abre una incidencia **antes** de escribir el código y explica por qué ninguna
   clave existente sirve.
2. Si se acepta, añade la clave a **los ocho archivos de locales en el mismo
   pull request**. No vale «luego lo traduzco»: dejar un idioma sin la clave
   rompe la auditoría y, peor, hace que la interfaz muestre el nombre técnico de
   la clave en ese idioma.
3. **Respeta los marcadores de posición byte a byte.** La auditoría compara los
   `{...}` de cada valor con el canónico y falla si no coinciden. Hoy existen
   exactamente cuatro: `{n}` (11 usos), `{fp}` (3), `{name}` (1) y `{km}` (1).
   Nunca traduzcas ni muevas las llaves: `{n} palabras preservadas` → `{n} words
   preserved`, no `{N} words preserved` ni `{ n }`.
4. Recuerda que `titleKey` y `subKey` de tu módulo también son claves y también
   van en los ocho archivos.

La cadena de respaldo es `idioma actual → en → es → la propia clave`. Si ves una
clave literal en pantalla, significa que falta en los tres.

---

## 9. Accesibilidad

Objetivo: **WCAG 2.2 AA**. La lista que tu contribución tiene que pasar:

| Requisito | Cómo se cumple aquí |
|---|---|
| **Nombre accesible en todos los controles** | `aria-label` en botones de solo icono; `label` en campos; `aria-label` en columnas y contenedores con nombre |
| **Operable con teclado** | Todo por `Tab`, `Enter` y `Espacio`. Pestañas con `role="tab"` y `aria-selected`; tarjetas-botón con `tabindex="0"` y manejo de teclas; atajos `/` (enfoca el primer buscador de la vista actual; si la vista no tiene ninguno, no hace nada) y `1`…`7` (módulos) |
| **Foco visible** | No elimines contornos. `base.css` define `:focus-visible` con el token `--ring` para enlaces, botones, campos y `[tabindex]` |
| **Foco gestionado en diálogos** | `ctx.openModal` aplica `role="dialog"`, `aria-modal`, cierra con `Escape` y mueve el foco. No escribas modales a mano |
| **`aria-live` para el estado asíncrono** | Los avisos son `role="status"` con `aria-live="polite"`; el panel de salida de LINGUA y el estado de emparejamiento de SYNAPSE también. Si tu operación tarda, anúncialo (`.spinner` + texto) |
| **`prefers-reduced-motion`** | `base.css` desactiva animaciones y `U.prefersReducedMotion()` —que también hace que `U.haptic` no vibre— está disponible en `ctx.U` |
| **Contraste** | Usa los tokens (`--text`, `--text-dim`, `--text-soft`, `--text-faint`, `--primary`, `--accent`…), que cambian con el tema. Si introduces un color nuevo, compruébalo en claro y en oscuro; `prefers-contrast: more` ya está contemplado |
| **Objetivos táctiles** | `.btn` tiene 42 px de alto mínimo; `.btn.sm` y `.btn.icon.sm` (34 px) solo para acciones secundarias |
| **Estructura** | `lang`, `viewport`, `<main>`, enlace de salto al contenido y HTML semántico: la auditoría avisa si alguno desaparece |
| **Sin trampas de teclado** | Nada de `keydown` global que capture teclas mientras se escribe: el manejador de atajos del proyecto ignora `input`, `textarea`, `select` y `contenteditable` |

---

## 10. Rendimiento

Presupuesto y reglas:

1. **Sin bucles pesados.** Nada de recorrer toda una colección dentro de un
   bucle sobre otra colección sin necesidad; el emparejamiento de SYNAPSE es el
   único sitio donde eso está justificado y allí hay un umbral y un guardia
   `state.busy`.
2. **Entrada de texto con `debounce`.** La búsqueda del Diccionario Vivo usa
   220 ms. `ctx.refresh` ya viene con 40 ms. No repintar en cada tecla.
3. **Respeta `ctx.state.lite`.** El modo ligero se activa con
   `saveData`, 2 núcleos o 2 GB de memoria (`deviceTier()`), y el usuario puede
   forzarlo en Ajustes. Ejemplos reales: el panel no dibuja el gráfico si
   `state.lite`; SOS no carga Leaflet y cae a la lista local; MEMORIA y VERITAS
   consultan `ctx.state.lite` antes de hacer trabajo caro. Tu módulo debería
   hacer lo mismo con lo que sea caro.
4. **`Store.patch` en vez de leer-modificar-escribir.** `patch` lee el registro
   actual, fusiona y actualiza `updatedAt`. Un ciclo manual de lectura y
   escritura pierde los cambios que hayan hecho otros entre medias (por ejemplo,
   dos personas moviendo la misma tarjeta del Kanban).
5. **Cachea las verificaciones caras.** Verificar una firma ECDSA es asíncrono y
   no gratis. El patrón del proyecto es resolverlo **una vez** por registro y
   escribir el veredicto en la insignia, no en cada repintado.
6. **Montaje rápido y limpieza completa.** Cambiar de módulo desmonta el
   anterior: si no cancelas `scope`, temporizadores, cámara, micrófono o mapas,
   el módulo viejo sigue consumiendo batería invisiblemente.

---

## 11. Antes de abrir un pull request

```bash
node tools/audit.mjs     # debe salir con código 0
node tools/e2e.mjs       # ninguna ✗ : la última línea dice «N/N correctas»
```

Además, a mano: instala la aplicación, **activa el modo avión**, recarga y
comprueba que tu funcionalidad sigue ahí.

### Qué prueba cada comando

`tools/audit.mjs` es estático (no abre navegador) y hoy termina con
**20 correctas · 0 advertencias · 0 fallos**, agrupadas en los seis bloques que el
propio script imprime al cerrar cada sección:

| Grupo | Qué demuestra |
|---|---|
| **Estructura y sintaxis** | `node --check` sobre los 28 archivos `.js`/`.mjs` y validez de los 6 JSON. Un error de sintaxis se detecta aquí y no en el navegador del usuario |
| **Arquitectura de módulos** | Que los 7 módulos declaran el contrato completo (`id`, `icon`, `accent`, `titleKey`, `subKey`, `mount`), que el `id` coincide con el nombre del archivo, que todo lo importado por `app.js` existe en disco y que **ningún módulo importa el núcleo de la aplicación** (dependencia circular) |
| **Internacionalización** | Que los 8 diccionarios tienen exactamente las 502 claves del canónico (ni una de menos, ni una de más), que los marcadores `{…}` coinciden entre idiomas y que toda clave usada en el código existe |
| **Entrega sin conexión** | Que cada recurso de la lista `SHELL` del Service Worker existe de verdad (39 recursos), más las 14 fuentes auto-alojadas **y**, en la otra dirección, que todo archivo de ejecución de `js/`, `css/`, `data/` y `assets/` está precargado (37 archivos). Es lo que garantiza que la aplicación instalada funcione sin red, y lo que hace imposible olvidar el paso 5 de §5.2: la comprobación *Cobertura del precache* **falla** si un módulo nuevo se queda fuera de `SHELL` |
| **Documento y accesibilidad** | Que los recursos referenciados por `index.html` existen, que las etiquetas cierran en orden y que siguen ahí `lang`, `viewport`, `<main>` y el enlace de salto |
| **Contenido de arranque** | Que los datos semilla son válidos y que al menos una capacidad comparte categoría con algún problema: sin eso, SYNAPSE no tendría nada que cruzar al abrir |

`tools/e2e.mjs` es lo que la auditoría **no** puede comprobar: abre Chrome o Edge
en modo headless por el Protocolo de DevTools y verifica contra un navegador real
lo que ningún análisis estático ve —arranque del armazón, onboarding, que la
interfaz sea realmente visible y no esté tapada por una superposición, las 9
rutas, emparejamiento con resultados, generación de claves ECDSA, que una firma
**sigue siendo válida después de pasar por IndexedDB** y que una alteración del
contenido la invalida, que **suplantar la huella declarada por el firmante se
rechaza** (la huella se recalcula desde la clave pública), que el **pasaporte
exportado no contiene secretos** —ni filas de `identity` ni la clave privada ni
la clave de API—, traducción (y, **sin conexión**, el fraseo de emergencia en
**9 idiomas distintos**, cada uno con una frase propia en lugar de devolver el
original), sellos de VERITAS, SOS con mapa, búsqueda en
MEMORIA, caché del Service Worker, adaptación a cuatro tamaños de pantalla (móvil
de 390 px, móvil económico de 320 px, tableta y escritorio) sin desbordamiento
horizontal, los temas claro y oscuro, el **árabe en modo de derecha a izquierda
(RTL)** y, sobre todo, las pruebas con la red cortada a la página **y al propio
Service Worker**— más una comprobación final de que no hubo ninguna excepción ni
error de consola en toda la sesión.

Con el árbol actual son **más de veinte** comprobaciones, y el número crece con el
proyecto —de hecho creció mientras se escribía esta guía—, así que no memorices la
cifra: **el criterio es que no haya ninguna `✗`**. El script sale con código 1 en
cuanto una falla, y termina siempre con una línea del tipo «prueba de extremo a
extremo: N/N correctas», donde N es el total de comprobaciones de esa versión del
script. Si el script se interrumpe por una
excepción, el informe añade una comprobación extra de «Ejecución de la prueba»
que también aparece como fallo.

Necesita el servidor levantado (`node tools/serve.mjs`) y un navegador
compatible. Opciones útiles: `--url http://127.0.0.1:8188`,
`--browser "C:\ruta\chrome.exe"`, `--dump` (vuelca el DOM si algo falla),
`--boot-only` (se detiene tras el arranque) y `--shots <carpeta>` (guarda
capturas de pantalla; solo escribe archivos si se lo pides).

En el pull request, cuenta: qué problema resuelve, cómo lo has probado, si has
tocado datos semilla o traducciones, y cualquier límite honesto que hayas
dejado. Un límite declarado es mucho más útil que un límite escondido.

---

## 12. Cómo contribuir sin escribir código

Hoy, la contribución de mayor valor **no es un pull request de código**. Es
cualquiera de estas:

| Contribución | Por qué importa | Qué necesitas |
|---|---|---|
| **Traducir o revisar la interfaz** | Hay 8 idiomas con 502 claves cada uno, y una traducción revisada por quien la habla de verdad vale más que diez idiomas generados | Hablar el idioma. Revisa `js/locales/<código>.js` entero y corrige lo que suene a traducción automática. La cadena de respaldo es `en`→`es`, así que un error en `en` afecta a todos |
| **Aportar palabras al Diccionario Vivo** | Cada lengua que no se registra es una forma de ver el mundo que se pierde. Las palabras se firman, admiten audio de pronunciación, variante dialectal y comunidad hablante | Abre LINGUA → Diccionario, añade tu palabra, graba el audio si puedes |
| **Curar MEMORIA** | Dos o más curadores con una media de 4 sobre 5 hacen que un saber reciba el sello de calidad validada. La curación es una nota firmada, no un «me gusta» | Conocimiento del tema, no del código |
| **Verificar afirmaciones en VERITAS** | La evidencia es obligatoria para votar: verdadero, falso, falta contexto o no verificable. El consenso solo se sella con 5 votos o más y un 66 % de acuerdo | Fuentes reales y criterio |
| **Revisar los datos semilla** | Los datos de ejemplo incluyen palabras de lenguas originarias y saberes que **deben validarse con hablantes nativos** antes de tomarse como referencia. La interfaz los marca como *Demostración*, pero igualmente pueden hacer daño si están mal | Ser parte de esa comunidad o hablante de esa lengua |
| **Probar en hardware real** | Safari/iOS, Firefox y teléfonos de gama muy baja están pendientes de prueba. Un informe honesto de lo que se rompe vale mucho | Un dispositivo y paciencia |

Si contribuyes contenido, léete la sección siguiente: las licencias y la ética
del contenido importan tanto como su calidad.

---

## 13. Ética y contenido

Los compromisos del proyecto, que también son reglas para quien contribuye:

- **Sin vigilancia.** No hay servidores, ni analítica, ni rastreadores, ni
  «mejoras de producto» basadas en el comportamiento. La única telemetría es un
  contador local que el usuario puede ver y borrar.
- **Sin mecánicas de enganche.** No hay rachas, ni insignias por volver, ni
  notificaciones que existen para retener. Las notificaciones existen para avisar
  de algo que importa.
- **Sin patrones oscuros.** El botón de borrar datos es tan visible como el de
  guardarlos. La importación avisa con honestidad cuando una firma no es
  verificable. Nunca uses una confirmación engañosa.
- **Contenido con licencia Creative Commons BY-SA 4.0.** Todo lo que aportes
  (saberes, palabras, traducciones) se comparte bajo esa licencia, y sigue
  perteneciendo a las comunidades que lo generaron.
- **No aportes datos personales de terceros sin su consentimiento.** Los
  registros llevan una huella firmada de quien los publica y se exportan con
  facilidad. Una alerta de SOS con la ubicación de otra persona, sin su permiso,
  es un daño, no una contribución.
- **SOS es para emergencias reales.** Las alertas admiten ubicación y suman
  confirmaciones de otras personas; no las uses para pruebas. Para probar el
  módulo usa los datos de ejemplo.
- **Los datos semilla son ilustrativos.** Están marcados como *Demostración* en
  la interfaz por una razón: deben validarse con las comunidades a las que se
  refieren antes de usarse como fuente. Si sabes que uno está mal, corrígelo o
  dilo.

---

## 14. Comunidad y conducta

No hay un código de conducta de veinte páginas porque no hace falta. Hay cuatro
acuerdos:

1. **Asume buena fe.** Casi todos los errores de este proyecto son de
   información, no de intención.
2. **Discute el problema antes de la solución.** Un cambio que no responde a la
   pregunta de la sección 1 se discute mejor antes de escribirlo que después.
3. **Bienvenida a quien no habla español ni inglés como lengua materna.** Escribe
   claro, evita las abreviaturas y las bromas internas, y no corrijas el idioma
   de nadie en público.
4. **Nada de acoso.** Ni por idioma, ni por origen, ni por nivel técnico, ni por
   nada. Quien lo haga no participa.

Y una nota sobre el ritmo: este es un proyecto de personas que, en su mayoría,
no cobran por él. Si una revisión tarda, insiste con educación; si algo está
parado, dilo.

---

## 15. Licencia de las contribuciones

**El código se distribuye bajo MIT**, según el archivo `LICENSE` de la raíz:
puedes usarlo, modificarlo, integrarlo y venderlo, siempre conservando el aviso
de copyright. **El contenido se distribuye bajo Creative Commons BY-SA 4.0**:
saberes, palabras, traducciones, datos semilla y documentación pueden
compartirse y adaptarse, incluso con fines comerciales, siempre que se
reconozca la autoría y que las obras derivadas se compartan bajo la misma
licencia.

En la práctica: al abrir un pull request aceptas que tu aportación se publique
bajo esas dos licencias según sea código o contenido; conservas tu autoría (y,
cuando aportas contenido desde tu dispositivo, también la huella de tu identidad
NEXUS); cualquiera —una comunidad, una clínica, un municipio, una empresa— puede
reutilizar lo que aportas; y nadie podrá cerrar lo que tú has abierto. Esa
simetría es deliberada: **el conocimiento preservado pertenece a las comunidades
que lo generaron y tiene que seguir siendo compartible.**
