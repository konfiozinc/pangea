# PANGEA

**Herramientas de coordinación para donde no llega la red.**

Un puesto de salud a cuatro horas del hospital. Un comité de agua cuyo río se está secando. Una escuela rural sin luz para las clases nocturnas. Una brigada de rescate con las torres de telefonía caídas. Una comunidad cuyo idioma no aparece en ningún traductor.

Esos son los usuarios de este programa. No «la humanidad»: **comunidades concretas con problemas concretos**, casi siempre en lugares donde las herramientas que existen dan por supuesto algo que allí no hay — conexión, electricidad, una cuenta, un servidor, alguien que hable tu idioma.

PANGEA es una aplicación web que funciona **sin servidores, sin cuentas y sin conexión**, y que resuelve cinco cosas que hoy no están resueltas en esos lugares:

| Problema real | Lo que hace el programa |
|---|---|
| Nadie entiende el idioma del otro | Traduce 12 idiomas, con voz, y conserva las lenguas que ningún traductor cubre |
| Quien tiene un problema no encuentra a quien sabe resolverlo | Cruza problemas con capacidades y explica **por qué** los empareja |
| No se sabe qué información es cierta | Verificación por consenso con evidencia firmada, sin dueño de la verdad |
| El conocimiento local se pierde | Archivo buscable sin conexión, con licencia abierta y exportable |
| La red se cayó justo cuando hacía falta | Alertas que viajan como archivo firmado por USB, Bluetooth, radio o SMS |

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   LINGUA    hablan idiomas distintos  →  se entienden                    │
│   SYNAPSE   uno tiene el problema     →  otro tiene la solución          │
│   VERITAS   alguien afirma algo       →  la comunidad lo verifica        │
│   MEMORIA   un saber puede perderse   →  queda archivado para siempre    │
│   SOS       alguien necesita ayuda    →  la red responde, incluso sin red│
│   AGENTE    tú no puedes estar ahí    →  tu agente filtra por ti         │
│   NEXUS ID  nadie te borra            →  tu identidad es tuya            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Cada decisión de diseño responde a una sola pregunta:

> ¿Esto ayuda a que dos personas que no se conocen puedan resolver un problema real en 60 segundos, aunque no tengan conexión, ni cuenta, ni el mismo idioma?

## Lo que este programa NO es

Es tan importante como lo anterior, y ahorra decepciones:

- **No es una red social ni una aplicación de mensajería.** Nadie necesita una cuarta. Donde WhatsApp funciona, WhatsApp es mejor para conversar. PANGEA sirve para lo que WhatsApp no puede hacer: funcionar sin red, firmar lo que se afirma y cruzar problemas con soluciones.
- **No aspira a que la use «toda la humanidad».** Una red de coordinación vale por la **densidad** de gente que tiene el problema, no por el número total de usuarios. Quinientos usuarios dispersos por el mundo valen cero; cincuenta personas de un mismo comité de agua valen mucho. Perseguir escala global haría el programa peor, no mejor.
- **No sustituye a un hospital, a un Estado ni a una ONG.** Es infraestructura de coordinación: ayuda a que lo que ya existe se conecte mejor, y sobre todo a que siga funcionando cuando la infraestructura falla.
- **No tiene servidores ni nube.** No hay nada que se caiga, nada que pagar y nadie que pueda cortar el acceso.

La visión grande —que la coordinación humana deje de depender de quién tiene mejor conexión— sigue ahí, como horizonte. Pero lo que se construye y se mide es lo de la tabla de arriba, comunidad por comunidad.

---

## Tabla de contenido

- [Pruébalo en 60 segundos](#pruébalo-en-60-segundos)
- [Para quién es esto: cuatro escenarios reales](#para-quién-es-esto-cuatro-escenarios-reales)
- [Cómo llega a la gente, sin publicidad y sin servidores](#cómo-llega-a-la-gente-sin-publicidad-y-sin-servidores)
- [Los siete módulos](#los-siete-módulos)
- [Lo que hace diferente a PANGEA](#lo-que-hace-diferente-a-pangea)
- [Lo que está verificado y lo que es demostración](#lo-que-está-verificado-y-lo-que-es-demostración)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Despliegue](#despliegue)
- [Herramientas de desarrollo](#herramientas-de-desarrollo)
- [Internacionalización](#internacionalización)
- [Accesibilidad](#accesibilidad)
- [Cómo contribuir](#cómo-contribuir)
- [Hoja de ruta](#hoja-de-ruta)
- [Privacidad: qué hace PANGEA con tus datos](#privacidad-qué-hace-pangea-con-tus-datos)
- [Créditos y licencia](#créditos-y-licencia)

---

## Para quién es esto: cuatro escenarios reales

Escenarios concretos, verificables y sin épica. Los cuatro se pueden reproducir hoy con este código.

**1. El terremoto.** Las torres están caídas. Una persona emite una alerta con su ubicación, la exporta como archivo firmado y la pasa por Bluetooth al teléfono de quien va a pie al pueblo siguiente. Allí otra persona la importa, ve la misma información —qué se necesita, cuántas personas, qué recursos ya van en camino— y responde con lo que tiene. Nadie necesitó internet en ningún momento. *Módulos: SOS, NEXUS ID.*

**2. El agua del barrio.** El agua llega contaminada dos días por semana. El comité publica el problema; alguien a doscientos kilómetros publicó hace un año que sabe construir filtros cerámicos. El sistema los cruza, explica por qué encajan (afinidad de significado, misma categoría, cercanía) y quedan en contacto. Cuando lo resuelven, ambos suman reputación **firmada que pueden demostrar sin pedirle permiso a ninguna plataforma**. *Módulos: SYNAPSE, NEXUS ID.*

**3. La lengua que se apaga.** Una persona mayor de una comunidad nasa registra cuarenta palabras con su pronunciación. Su nieta las consulta sin conexión desde el teléfono. Un investigador las exporta con licencia abierta. Esa lengua tiene ahora un lugar donde estar que no depende de que una empresa decida mantener el servicio. *Módulos: LINGUA, MEMORIA.*

**4. La afirmación que circula.** Alguien dice que el agua hervida es suficiente para eliminar un contaminante concreto. Tres personas con conocimiento técnico responden con evidencia y fuentes; una matiza que depende del contaminante. El sistema muestra el grado de acuerdo real, **advierte si los votos llegaron en ráfaga o con evidencia repetida** —señal de manipulación— y no declara verdad nada que la comunidad no haya sostenido. *Módulos: VERITAS.*

Si ninguno de estos cuatro escenarios te resulta reconocible, este programa no es para ti, y está bien: es una herramienta, no un producto de consumo.

---

## Cómo llega a la gente, sin publicidad y sin servidores

Esta pregunta —cómo se conoce algo así sin dinero— tiene una respuesta técnica, no publicitaria.

**El coste de distribución es cero, y eso es estructural, no un truco.** No hay tienda de aplicaciones que apruebe o cobre: es una PWA, se instala desde el navegador. No hay servidores que mantener: se aloja copiando una carpeta en cualquier alojamiento estático gratuito (GitHub Pages, Cloudflare Pages, Netlify) y funciona igual para diez personas que para diez mil, porque **cada dispositivo es su propio servidor**.

**Viaja dentro de los canales que la gente ya usa.** Este es el punto clave y ya está en la arquitectura: PANGEA no compite con WhatsApp ni con los mensajes de texto, **se transporta dentro de ellos**. Una alerta, un saber o un emparejamiento se exportan como un archivo que se puede enviar por SMS, por Bluetooth, por radio o llevar en un USB. No hace falta que nadie «adopte la aplicación»: basta con que una persona la tenga y el archivo camine solo.

**El código abierto es un canal, no un trámite.** Los desarrolladores, las ONG y las universidades encuentran lo que pueden leer y auditar. La especificación del protocolo (`docs/PROTOCOLO-PANGEA.md`) permite que otras herramientas se conecten sin pedir permiso.

**Se capturan problemas, no se persiguen usuarios.** Nadie busca «aplicación de inteligencia colectiva». Sí se busca «cómo filtrar agua turbia», «cómo secar maíz sin electricidad», «cómo llevar historias clínicas sin internet». Si el conocimiento que el archivo guarda es útil y está bien descrito, la herramienta llega con él.

**Y la adopción empieza por una sola comunidad.** Un puesto de salud, un comité de agua, una escuela o una brigada que lo use para un problema real y pueda mostrar el resultado vale más que un millón de instalaciones pasivas. Así crecieron Wikipedia, Linux y Ushahidi: sin un solo anuncio. La pregunta que hay que hacerse no es «cómo llego a 8 000 millones de personas», sino **«cuál es la primera comunidad que lo va a usar la semana que viene, y a quién le resuelve un problema»**.

---

## Pruébalo en 60 segundos

Necesitas [Node.js 20+](https://nodejs.org) para el servidor de desarrollo. **No hay que instalar nada más**: PANGEA no tiene dependencias npm.

```bash
cd PANGEA
node tools/serve.mjs          # o: npm start
```

Abre **http://127.0.0.1:8188** en el navegador.

> La dirección `127.0.0.1` cuenta como *origen seguro* para los navegadores, así que el Service Worker, la criptografía y la geolocalización funcionan sin HTTPS ni certificados.

**La prueba que de verdad importa:**

1. Abre la aplicación e instálala desde el icono de la barra de direcciones.
2. **Activa el modo avión.**
3. Recarga la página.

Debe seguir funcionando: los siete módulos, la búsqueda, el archivo y hasta la traducción de frases de emergencia. Eso es lo que significa *offline-first*, y está comprobado de forma automática en cada auditoría (ver [Verificación](#verificación)).

También puedes desplegarla en cualquier alojamiento estático (GitHub Pages, Netlify, Cloudflare Pages, un servidor propio) copiando la carpeta tal cual. No hace falta backend.

---

## Los siete módulos

### 🌐 LINGUA — Traducción universal en tiempo real

Traducción entre **12 idiomas** con voz de ida y vuelta, más un **Diccionario Vivo** donde cualquiera puede registrar palabras de su lengua originaria antes de que desaparezcan.

- **Traducción de texto** con cadena de degradación: caché local → API pública MyMemory (sin clave) → nodo LibreTranslate propio (opcional) → **fraseo de emergencia local** de 14 frases × 12 idiomas que funciona **sin ninguna conexión**.
- **Voz**: reconocimiento (`SpeechRecognition`) y síntesis (`SpeechSynthesis`) nativos, con reserva a texto si el navegador no los soporta.
- **Conversación bidireccional**: dos personas, dos idiomas, un dispositivo; cada turno se traduce y se pronuncia al instante.
- **Lengua de señas (demostración)**: reconocimiento de 8 señas estáticas con MediaPipe Hands, **procesado íntegramente en el dispositivo**; se carga solo al pulsar el botón y nunca se envía vídeo a ningún sitio.
- **Diccionario Vivo**: cada palabra se firma con la identidad de quien la aporta, admite audio de pronunciación, variante dialectal y comunidad hablante, y se exporta como `pangea-lingua-dictionary`.

### 🔗 SYNAPSE — Motor de emparejamiento problema ↔ solución

Publicas un **problema** o una **capacidad**. El motor cruza ambos y propone colaboraciones con una **puntuación explicable**: nunca un número sin razones.

| Componente | Peso | Qué mide |
|---|---|---|
| Afinidad semántica | 45 | Significado del texto, no palabras exactas |
| Misma categoría | 20 | Taxonomía compartida de 14 áreas |
| Conceptos compartidos | 12 | Términos en común ponderados por rareza |
| Urgencia del problema | 10 | Lo urgente sube en la cola |
| Cercanía geográfica | 8 | Distancia real (Haversine) |
| Idioma compartido | 5 | Colaborar es más fácil sin traducción |

El tablero Kanban tiene cuatro columnas — *problemas abiertos*, *matches sugeridos*, *en colaboración*, *resueltos* — y se puede arrastrar o usar botones (accesible con teclado). Cada colaboración completada otorga **Pangea Points** con una atestación firmada que cualquiera puede verificar.

El motor semántico tiene **dos niveles**: un modelo neuronal MiniLM vía `transformers.js` en un Web Worker cuando está disponible, y embeddings locales por n-gramas (técnica *hashing trick*) cuando no hay red. **PANGEA nunca necesita internet para razonar sobre el significado de un texto.**

### 🛡️ VERITAS — Verificación colectiva de información

Cualquiera publica una **afirmación**; la comunidad vota *verdadero*, *falso*, *falta contexto* o *no verificable* — siempre **aportando evidencia**, que es obligatoria.

- **Matemática del consenso**: verdadero `+1`, falso `−1`, falta contexto `+0.35`, no verificable `0` (excluido del denominador). El sello *Consenso PANGEA* aparece con 5 o más votos y un 66 % o más de acuerdo.
- **Detector de anomalías** propio: ventanas deslizantes de 90 segundos, ráfaga de 3 votos en 20 segundos y ratio de diversidad de evidencia. Los patrones sospechosos se marcan y se explican con los números concretos medidos.
- **Índice de credibilidad** de 0 a 100 combinando volumen de votos, calidad de la evidencia, número de fuentes y penalización por anomalía.
- **Contraste externo opcional** con la API de Google Fact Check (requiere clave propia, se guarda solo en tu dispositivo y nunca es obligatorio).

### 📚 MEMORIA — Preservación del conocimiento humano

Archivo descentralizado de saberes tradicionales, científicos y técnicos, con licencia abierta.

- Búsqueda instantánea con **MiniSearch** y, si no está disponible, con un índice propio (TF·IDF + prefijo + realce de título) que funciona sin conexión.
- Contenido en texto, audio, imagen o documento; **grabación de audio** con `MediaRecorder`; límite de 8 MB por archivo.
- Licencias Creative Commons seleccionables (BY, BY-SA, CC0, todos los derechos).
- **Curaduría voluntaria**: puntuación de 1 a 5 con nota firmada; con dos o más curadores y media de 4, el saber recibe el sello de calidad validada.
- Exportación a ZIP con **manifiesto firmado** (`pangea-memoria`) e importación que verifica la firma y avisa honestamente cuando no es verificable.

### 🆘 SOS — Red de respuesta a emergencias

La parte que tiene que funcionar precisamente cuando todo lo demás falla.

- Alerta con tipo, gravedad, descripción y ubicación opcional (geolocalización o manual), con vibración y anillo pulsante en las críticas.
- Mapa Leaflet + OpenStreetMap con marcadores coloreados por gravedad y distancias reales. **Si Leaflet no está disponible —porque no hay red la primera vez— cae con elegancia a una lista ordenada por distancia calculada localmente.**
- Respuesta con recursos concretos: transporte, refugio, agua, medicinas, alimentos, conocimientos médicos o técnicos, comunicaciones, energía.
- Confirmación por consenso: cada persona que confirma una alerta suma su huella.
- **Modo malla**: exporta las alertas como un archivo **firmado** (`pangea-sos`) que viaja por USB, Bluetooth, radio o mensaje de texto. Otro nodo PANGEA lo importa, verifica la firma y ve la misma información. El salto físico es lo único que un navegador no puede hacer; el resto está implementado y verificado.

### 🤖 AGENTE — Tu representante personal

Un motor de reglas **auditable** que vigila la red en tu nombre y te avisa solo cuando vale la pena. No usa inteligencia artificial externa por defecto: son seis reglas que puedes inspeccionar una por una.

| Regla | Puntos |
|---|---|
| El área coincide con tus intereses | +34 |
| Afinidad semántica con tus intereses | +22 × afinidad |
| Urgencia crítica / alta | +14 / +8 |
| Idioma en el que trabajas / desconocido | +10 / +4 |
| Disponible / ocupado + urgente | +10 / +4 |
| Es tu propia publicación | −20 |

Umbral de sugerencia: 55 puntos. Cada sugerencia muestra **el desglose completo de puntos**, y con autonomía alta y autoemparejamiento activo el agente puede proponer la colaboración por ti (con un registro de decisiones limitado a 50 entradas). Opcionalmente admite un endpoint compatible con la API de OpenAI, pero **nada del módulo depende de él**.

### 🪪 NEXUS ID — Identidad descentralizada

Al primer uso se genera un par de claves **ECDSA P-256** en tu dispositivo. Tu clave pública *es* tu identificador. No hay registro, no hay autoridad, no hay nadie que pueda borrarte.

- Huella legible **`PAN-XXXX-XXXX-XXXX`** derivada de SHA-256 de la clave pública con un alfabeto sin caracteres ambiguos.
- Cada contribución se firma y **cualquiera puede verificarla, sin conexión, años después**. Si alguien altera el contenido, la verificación falla.
- Exportación cifrada de la identidad (`PANGEA-ID-1`: PBKDF2-SHA256 con 250 000 iteraciones → AES-GCM-256).
- **Pasaporte PANGEA**: un ZIP firmado con tu identidad, tu reputación y todas tus contribuciones para llevártelas a cualquier dispositivo.
- **Atestaciones de reputación** portables: verificables por un tercero sin servidor y sin confiar en PANGEA.
- **Telemetría ética**: un contador local que puedes ver y borrar. No se envía a ninguna parte.

---

## Lo que hace diferente a PANGEA

**1. Local-first de verdad.** El dispositivo es la fuente de verdad. No existe «la nube» a la que enviar tus datos; existe tu navegador y, si tu comunidad lo despliega, un nodo opcional.

**2. Sin conexión por defecto.** El modo sin conexión no es un estado de error: es el estado normal. El Service Worker precarga 56 recursos y aplica cuatro estrategias distintas según el tipo de petición.

**3. Cero servidores, cero cuentas, cero rastreadores.** No hay registro, no hay analítica de terceros, no hay fuentes de Google (se auto-alojan), no hay peticiones que no provoques tú.

**4. Degradación elegante en todo.** Cada dependencia externa —Leaflet, Chart.js, MiniSearch, MediaPipe, transformers.js, las APIs de traducción— está **detectada en tiempo de ejecución**. Si falta, el módulo sigue funcionando en modo local. Nada se rompe.

**5. Funciona en un teléfono de 20 dólares.** Sin frameworks, sin paso de compilación, 13 852 líneas de JavaScript nativo. El *modo nodo ligero* desactiva animaciones, modelo neuronal y gráficos. Los tiempos de montaje medidos por ruta están entre 51 ms y 324 ms.

**6. La reputación es tuya.** No es una puntuación en una base de datos ajena: es una atestación firmada criptográficamente que puedes llevar a otro dispositivo y que cualquiera puede comprobar matemáticamente.

**7. Es un protocolo, no solo una aplicación.** El formato de intercambio tiene nombre y especificación: **PKE — Pangea Knowledge Exchange**, un sobre JSON con las 15 colecciones, versionado con `spec: '1.0'`, que cualquier herramienta puede leer y escribir. Existe una [especificación abierta](docs/PROTOCOLO-PANGEA.md) con tres niveles de conformidad para que otras aplicaciones, nodos comunitarios, pasarelas SMS o mallas de radio puedan interoperar sin ejecutar este código.

**8. Pregunta antes de gastar tus datos.** El modelo neuronal (~20 MB) **nunca** se descarga sin consentimiento explícito: se pregunta una vez, se recuerda la respuesta, y sin él el motor local por n-gramas sigue emparejando. La ubicación de una alerta se **redondea a un kilómetro antes de firmarla**, salvo que la persona elija lo contrario. Y la telemetría local no sale ni en tu propio pasaporte.

**9. La navegación no se queda en el idioma anterior.** Cambiar de idioma reconstruye todo el armazón, no solo el contenido: barra lateral, navegación inferior y títulos. 551 claves en cada uno de los 8 idiomas, con árabe en RTL completo.

---

## Lo que está verificado y lo que es demostración

Creemos que la honestidad es parte de la ingeniería. Esto es lo que hay, sin adornos.

### Verificado automáticamente

Cada auditoría ejecuta 38 comprobaciones en un navegador real (Chrome/Edge headless vía DevTools Protocol). Resultado de la última ejecución: **38/38**.

| Verificación | Resultado medido |
|---|---|
| La aplicación arranca y dibuja el armazón | 8 elementos de navegación, 8 métricas, chip de identidad |
| El arranque no produce errores de JavaScript | ninguna excepción ni error de consola |
| El panel de mando dibuja gráficos y accesos directos | anillo de impacto pintado con Chart.js, 7 accesos a módulos |
| Onboarding presente y descartable | 7 pasos, avanza y se cierra |
| **La interfaz es realmente visible: nada la tapa** | se pregunta al navegador qué elemento hay delante: `div.hero-inner` |
| Los 9 destinos renderizan sin error | lingua 95 ms · synapse 167 ms · veritas 184 ms · memoria 324 ms · sos 127 ms · agente 306 ms · nexus 137 ms · ajustes 51 ms · panel 124 ms |
| SYNAPSE empareja problemas con capacidades | 6 emparejamientos en 4 columnas Kanban |
| NEXUS ID genera claves ECDSA P-256 | huella `PAN-XXXX-XXXX-XXXX` válida |
| La firma se verifica tras pasar por IndexedDB | firma válida al releer el registro |
| Una alteración del contenido invalida la firma | manipulación detectada |
| **Suplantar la huella del firmante se rechaza** | firma válida con `sig.fp` ajeno → rechazada |
| **El pasaporte exportado no contiene secretos** | 0 filas de identidad, sin clave privada, sin claves de API |
| LINGUA traduce texto | «Necesito ayuda» → «I need help» |
| VERITAS lista afirmaciones con su sello | 3 afirmaciones con 3 sellos de consenso |
| SOS monta alertas y mapa | mapa activo |
| MEMORIA busca en el archivo local | 5 saberes, búsqueda operativa, MiniSearch cargado |
| Service Worker registrado y caché poblada | 3 cachés, 56 recursos, página controlada |
| **SIN CONEXIÓN la aplicación sigue funcionando** | arranque completo con la red cortada a la página **y al Service Worker** |
| **SIN CONEXIÓN los módulos siguen navegables** | 5 tarjetas del archivo servidas desde caché |
| **SIN CONEXIÓN la traducción responde** | «Necesito agua potable» → «I need drinking water» (fraseo local) |
| **SIN CONEXIÓN traduce entre 9 idiomas distintos** | en · pt · fr · it · de · ar · hi · zh · ru, cada uno con una frase propia y distinta |
| **Se adapta a móvil, tableta y escritorio sin desbordar** | 390×844 · 320×640 · 768×1024 · 1440×900, sin desplazamiento horizontal en ninguno; navegación inferior y cajón en móvil, barra lateral en escritorio |
| **El árabe se aplica en modo RTL** | `dir=rtl`, navegación retraducida («لوحة القيادة») y vuelta a LTR |
| **El tema claro y el oscuro se aplican de verdad** | luminancia del fondo 251 → 14 |
| **El panel abre con «¿Qué necesitas?» y sus cinco salidas** | Tengo un problema · Puedo ayudar · Quiero compartir conocimiento · Quiero verificar información · Necesito ayuda urgente |
| **Publicar un problema desde el formulario real** | 6→7 registros en IndexedDB, firmado, con categoría y urgencia |
| **Publicar una capacidad desde el formulario real** | 7→8 registros, firmado |
| **El motor empareja lo que se acaba de publicar** | afinidad 67 % explicada con 6 razones |
| **Publicar una afirmación con contexto y firmarla** | 3→4 afirmaciones, contexto guardado |
| **Votar una afirmación aportando evidencia** | 13→14 votos registrados |
| **Preservar conocimiento desde el formulario real** | 5→6 saberes con licencia y firma |
| **Emitir una alerta SOS desde el formulario real** | 0→1 alertas, firmada, con tipo y gravedad |
| **Exportar e importar el paquete completo sin duplicar** | 0 nuevos, 74 omitidos: la reimportación es idempotente |
| **El perfil demuestra la autoría y lista los aportes** | huella recalculada desde la clave pública · 5 contribuciones |
| **Cada botón del panel abre directamente su formulario** | los 5 abren el formulario correcto sin buscar el botón |
| **El diseño no salta y la segunda visita es más rápida** | 1ª visita: LCP 3,2–5,3 s · TBT 0,7–1,1 s · HTML 9 KB ‖ **2ª visita desde caché: LCP 0,8–1,2 s · TBT 0–19 ms · 9 KB transferidos** |
| Sin errores de JavaScript en toda la sesión | ninguna excepción |

Las últimas diez no leen el DOM: **abren los formularios reales, escriben en los campos, pulsan guardar y comprueban que el registro llegó a IndexedDB firmado**. Es la distinción que este proyecto se exige a sí mismo entre «la interfaz existe» y «la función está implementada».

Además, `tools/audit.mjs` verifica 20 comprobaciones estáticas repartidas en 6 bloques — estructura y sintaxis, arquitectura de módulos, internacionalización, entrega sin conexión, documento y accesibilidad, y contenido de arranque —: sintaxis de 29 archivos, contrato de los 7 módulos, ausencia de dependencias circulares, 551 claves en cada uno de los 8 idiomas con paridad de marcadores, los recursos del Service Worker existentes, la **cobertura** del precache (que no falte ningún archivo de ejecución), referencias del HTML, balance de etiquetas, validez de los 6 JSON y coherencia de los datos semilla. Última ejecución: **20 correctas, 0 advertencias, 0 fallos**.

```bash
node tools/audit.mjs     # debe salir con código 0
node tools/e2e.mjs       # debe reportar 38/38
```

### Demostración o límite conocido

| Elemento | Estado honesto |
|---|---|
| **Modo malla de SOS** | El paquete firmado se genera, se exporta y se importa de verdad, con verificación de firma, y **viaja con las respuestas de la red** (transporte, refugio, agua…) además de las alertas. El salto físico (USB, radio, SMS) ocurre fuera del navegador: PANGEA lo explica, no lo simula. |
| **Lengua de señas** | Reconocedor de 8 **posturas estáticas** de la mano. No es un intérprete de lengua de señas real, que es gramatical y tridimensional. |
| **Frases de emergencia** | 14 frases traducidas a 12 idiomas, curadas a mano para que funcionen sin red. No sustituyen a un traductor. |
| **Datos semilla** | 6 problemas, 7 capacidades, 5 saberes, 3 afirmaciones **con 13 votos argumentados**, 8 palabras de lenguas originarias. Todo **ilustrativo**: los saberes y las palabras deben verificarse con hablantes nativos antes de usarse como referencia, y la interfaz los marca como *Demostración*. Los votos sirven para que el mecanismo de consenso sea visible desde la primera visita. |
| **Nodo comunitario** | El campo de configuración y el worker de sincronización existen; el endpoint es un marcador de posición. PANGEA funciona entero sin él. |
| **Sincronización entre dispositivos** | Hoy se hace con el Pasaporte PANGEA (exportar/importar). La sincronización automática es la Fase 2 de la hoja de ruta. |
| **Capturas en el manifiesto** | Se omitieron deliberadamente en lugar de incluir imágenes falsas. |
| **Cobertura de navegadores** | Verificado a fondo en Chromium. Safari/iOS, Firefox y hardware de gama muy baja están pendientes de prueba. |
| **Medición de rendimiento** | Medida con la API de rendimiento del propio navegador contra **un servidor de desarrollo**, sin compresión ni HTTP/2, en una sola máquina y un solo navegador. No es una medición de campo. |
| **Lighthouse** | Mide **Accesibilidad 100** y **SEO 100**. Las categorías de Rendimiento y Buenas Prácticas aparecen como *sin medir*: Lighthouse no consigue trazar la navegación en este entorno (`NO_NAVSTART`). **No se publican como 0 porque no lo son: es una medición ausente.** Por eso el rendimiento se mide aparte con la API del navegador. |

### Defectos graves encontrados y cerrados durante el desarrollo

Ninguno de estos aparecía en una validación de sintaxis, y cuatro de ellos habrían pasado desapercibidos hasta producción. Se listan porque un proyecto que pide confianza debe enseñar sus cicatrices.

| Defecto | Cómo se detectó | Estado |
|---|---|---|
| **La huella del firmante era suplantable.** `verify()` validaba la firma contra `sig.pub` pero nunca comprobaba que `sig.fp` correspondiera a esa clave: se podía firmar con la clave propia y mostrar la huella de otra persona. | Lo destapó la redacción de la especificación, al transcribir el algoritmo de verificación. | Cerrado: la huella se recalcula siempre desde la clave pública y una discrepancia invalida la verificación. Verificado en la prueba E2E. |
| **El Pasaporte exportaba la clave privada en claro** (y las claves de API configuradas), en un archivo pensado para llevarse en un USB o compartirse. | Lo destapó la redacción de la especificación, al documentar qué contiene cada paquete. | Cerrado: la identidad solo viaja cifrada con contraseña; el paquete declara lo que omite. Verificado en la prueba E2E. |
| **El primer hijo pasado a `h()` se descartaba en silencio.** `h('section.hero', hijo)` interpretaba `hijo` como objeto de propiedades: sin error, sin aviso, simplemente desaparecía media interfaz. | Solo apareció al **mirar una captura de pantalla**. Todas las comprobaciones de DOM pasaban porque los elementos existían… salvo los que faltaban. | Cerrado en `utils.js`; se añadió un propio a la prueba que pregunta al navegador qué elemento hay delante del contenido. |
| **La pantalla de arranque nunca se retiraba.** El armazón renderizaba correctamente **detrás** de una capa opaca: la aplicación era invisible para una persona y perfecta para un test. | También solo al mirar una captura. | Cerrado con una regla CSS que no depende de que JavaScript se acuerde, y con una comprobación de visibilidad real en la prueba. |
| **El atajo `/` apuntaba a un elemento inexistente**, y el manejador global de teclado lanzaba una excepción cuando el evento no lo originaba un nodo del árbol. | Lo detectó la auditoría de arquitectura leyendo el código contra el HTML. | Cerrado: el atajo enfoca el primer campo de la vista actual y el manejador comprueba el tipo de objetivo. |
| **Peso de urgencia inerte:** el nivel «bajo» y «medio» aportaban 0 puntos al emparejamiento por un umbral mal puesto, contradiciendo la tabla de pesos documentada. | Auditoría de arquitectura, contrastando la tabla con el código. | Cerrado: la escala es continua (2/5/8/10). |
| **Las respuestas de SOS no viajaban en el paquete de malla:** el nodo receptor veía la alerta pero no los recursos que ya estaban en camino. | Auditoría de arquitectura, revisando qué incluye cada paquete. | Cerrado: el paquete transporta alertas **y** respuestas, con compatibilidad hacia atrás. |
| **`sync.worker.js` era código muerto** (precargado y nunca instanciado, con una promesa que jamás se resolvía) y su contrato contradiciendo al de `syncNow()`. | Auditoría de arquitectura. | Cerrado: la sincronización usa el worker y ambos comparten un único contrato de nodo. |
| **La auditoría del precache era unidireccional:** verificaba que lo listado existiera, pero no que todo lo necesario estuviera listado. Un módulo nuevo podía romper el modo sin conexión sin que nada avisara. | Auditoría de arquitectura. | Cerrado: la auditoría ahora comprueba la cobertura en ambos sentidos. |
| **Al cambiar de idioma, la navegación no se retraducía:** la barra lateral y la inferior se construyen una sola vez al arrancar, así que seguían en el idioma anterior aunque el contenido sí cambiara. | Lo destapó la comprobación de RTL añadida al final: el texto árabe aparecía, pero el menú seguía diciendo «Panel de mando». | Cerrado: cambiar de idioma reconstruye todo el armazón. |
| **Esperas frágiles en la propia prueba:** daba por buena una vista todavía vacía, así que el resultado cambiaba entre ejecuciones. | Se detectó al ejecutar la suite dos veces seguidas con resultados distintos (21/24 y 24/24). | Cerrado: la prueba espera contenido real de cada módulo. Tres corridas consecutivas dan 25/25. |
| **La telemetría local sí viajaba en los paquetes exportados**, contradiciendo la promesa de que nunca sale del dispositivo: un pasaporte puede acabar en un nodo comunitario ajeno. | Lo destapó la redacción de la especificación, al documentar el contenido exacto de cada paquete. | Cerrado: `identity` y `telemetry` están en `Store.NEVER_EXPORTED`. Verificado en la prueba E2E. |
| **El diálogo de introducción no tenía nombre accesible:** un lector de pantalla anunciaba «diálogo» sin decir de qué. | **Lighthouse**, auditoría de accesibilidad. | Cerrado con `aria-labelledby` apuntando a su propio título. |
| **Los puntos del onboarding medían 8×8 px:** eran botones, y con el dedo eran imposibles de acertar (el mínimo de WCAG 2.2 es 24×24). | **Lighthouse**, criterio 2.5.8. | Cerrado: el punto visible sigue midiendo 8 px, pero su área pulsable mide 26×26. |
| **Contraste insuficiente en la navegación activa:** el índigo puro sobre fondo claro da 3,7:1 y el texto pequeño necesita 4,5:1. | **Lighthouse**, criterio 1.4.3. | Cerrado mezclando el primario con el color de texto (82 %/18 %) sin cambiar la identidad cromática. |
| **No existía `robots.txt`:** el servidor devolvía la página principal ante esa ruta y el rastreador recibía HTML donde esperaba reglas (146 errores). | **Lighthouse**, auditoría de SEO. | Cerrado con un `robots.txt` real que además decide qué se indexa y qué no. |
| **El primer pintado esperaba a 42 escrituras en serie en IndexedDB.** La medición de rendimiento lo delataba como bloqueo del hilo principal. | Medición propia con la API de rendimiento del navegador. | Cerrado con `Store.putMany`: una sola transacción por colección en vez de una por registro. |
| **La prueba de extremo a extremo dejaba 7 procesos de navegador huérfanos por corrida.** En Windows `child.kill()` no mata el árbol de procesos, y a la cuarta medición el equipo estaba tan cargado que el LCP pasó de 1,7 s a 10 s **sin que el código hubiera empeorado**. | Se detectó al ver cifras que empeoraban de forma monótona entre corridas. | Cerrado: el arnés mata el árbol con `taskkill /T /F` y la medición se repite en un entorno limpio. |

---

## Arquitectura

```
index.html · manifest.json · service-worker.js         ← armazón y entrega
        │
        ▼
js/app.js  ── contexto (ctx), router por hash, navegación,
        │     onboarding, panel de mando, ajustes
        ▼
js/modules/  lingua · synapse · veritas · memoria · sos · agente · nexus-id
        │
        ▼
núcleo compartido
  store.js    IndexedDB + bus de eventos + exportar/importar
  crypto.js   ECDSA P-256, huellas, firmas, identidad cifrada
  engine.js   motor semántico de dos niveles con degradación
  i18n.js     8 idiomas × 551 claves, RTL, carga diferida
  utils.js    hyperscript h(), ZIP propio, embeddings locales, geolocalización
        │
        ▼
APIs del navegador   IndexedDB · Web Crypto · Speech · MediaRecorder · geolocalización
CDN opcionales       Leaflet · Chart.js · MiniSearch · MediaPipe · transformers.js
```

**El contrato de módulo** es la pieza que mantiene todo coherente:

```js
export default {
  id: 'modulo', icon: 'spark', accent: 'cyan',
  titleKey: 'modulo.title', subKey: 'modulo.sub',
  async mount(root, ctx) {
    // construye la interfaz dentro de `root` usando ctx
    return () => { /* limpia TODO: suscripciones, temporizadores, cámaras, mapas */ };
  },
};
```

Ningún módulo importa el núcleo de la aplicación (eso crearía una dependencia circular); todo llega a través de `ctx`. Cada efecto secundario debe ser reversible, porque cambiar de módulo desmonta el anterior.

Los detalles completos —modelo de datos, proyección canónica de firma, cadena de degradación del motor semántico, estrategias del Service Worker y decisiones descartadas— están en **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**.

---

## Estructura del proyecto

```
PANGEA/
├── index.html                      Armazón de la aplicación (SPA, HTML semántico)
├── offline.html                    Reserva autocontenida y multilingüe para cuando no hay nada cacheado
├── manifest.json                   Manifiesto PWA: instalable, atajos, compartir
├── service-worker.js               Entrega sin conexión: 4 estrategias de caché
├── package.json                    Solo declara ESM y comandos. Cero dependencias
├── LICENSE                         MIT (código) + nota sobre CC BY-SA (contenido)
│
├── assets/
│   ├── icons/                      SVG + PNG 192/512/maskable (generados)
│   ├── fonts/                      14 woff2 auto-alojados: cero peticiones a terceros
│   ├── audio/notificacion.wav      Aviso sonoro de dos tonos (generado)
│   └── img/                        Reservado para imágenes del proyecto
│
├── css/
│   ├── base.css                    Tokens, temas claro/oscuro, accesibilidad
│   ├── layout.css                  Armazón, barra lateral, navegación inferior
│   ├── components.css              Biblioteca de componentes reutilizables
│   ├── modules.css                 Estilos específicos de cada módulo
│   └── fonts.css                   @font-face generado
│
├── js/
│   ├── app.js                      Núcleo, contexto, router, panel, ajustes
│   ├── store.js                    IndexedDB, publicar/suscribir, exportar/importar
│   ├── crypto.js                   NEXUS ID: claves, firmas, identidad cifrada
│   ├── engine.js                   Motor semántico con degradación elegante
│   ├── i18n.js                     Internacionalización
│   ├── utils.js                    hyperscript, ZIP, embeddings locales, utilidades
│   ├── modules/                    Los 7 módulos
│   ├── workers/
│   │   ├── embeddings.worker.js    transformers.js en segundo plano
│   │   └── sync.worker.js          Sincronización opcional con un nodo propio
│   └── locales/                    es · en · pt · fr · ar · hi · zh · ru
│
├── data/
│   ├── categorias.json             Taxonomía compartida de 14 áreas
│   ├── idiomas.json                12 idiomas de trabajo
│   ├── frases-emergencia.json      Fraseo sin conexión: 14 frases × 12 idiomas
│   └── conocimiento-semilla.json   Contenido de ejemplo (marcado como demostración)
│
├── docs/
│   ├── ARQUITECTURA.md             Decisiones técnicas y diagramas
│   ├── PROTOCOLO-PANGEA.md         Especificación abierta de interoperabilidad
│   ├── CONTRIBUTING.md             Guía para contribuir
│   └── ROADMAP.md                  Visión a cinco años
│
└── tools/
    ├── serve.mjs                   Servidor local sin dependencias
    ├── audit.mjs                   Auditoría estática (6 bloques, 20 comprobaciones)
    ├── e2e.mjs                     Prueba real en navegador (38 comprobaciones)
    └── build-assets.mjs            Genera iconos, audio y tipografía auto-alojada
```

---

## Despliegue

PANGEA es un sitio estático. Cópialo y ya está.

**GitHub Pages**

```bash
git subtree push --prefix PANGEA origin gh-pages
```

**Netlify / Cloudflare Pages / Vercel**

Directorio de publicación: `PANGEA`. Comando de compilación: ninguno.

**Servidor propio (nginx)**

```nginx
location / {
  root /var/www/pangea;
  try_files $uri $uri/ /index.html;
}
location = /service-worker.js { add_header Cache-Control "no-cache"; }
```

**Un detalle que importa:** el Service Worker y el manifiesto deben servirse con `Cache-Control: no-cache` para que las actualizaciones se detecten. `tools/serve.mjs` ya lo hace. Todo lo demás puede cachearse con agresividad.

HTTPS es necesario en producción (salvo en `localhost`), porque los Service Workers, la criptografía y la geolocalización lo requieren. Cualquier alojamiento moderno lo da gratis.

---

## Herramientas de desarrollo

| Comando | Qué hace |
|---|---|
| `node tools/serve.mjs [--port 8188] [--host 127.0.0.1]` | Servidor estático local con los MIME correctos y sin caché en los archivos críticos |
| `node tools/audit.mjs` | Auditoría estática completa. Sale con código 1 si algo falla: sirve en integración continua |
| `node tools/e2e.mjs [--url …] [--browser …] [--dump]` | Prueba de extremo a extremo en un navegador real, incluido el modo avión. `--dump` vuelca el DOM si algo falla |
| `node tools/build-assets.mjs` | Regenera iconos PNG, aviso sonoro y tipografía auto-alojada |

Las cuatro herramientas usan **solo módulos nativos de Node**. No hay `npm install` en ningún punto del proyecto.

---

## Internacionalización

- **Interfaz: 8 idiomas** — español, inglés, portugués, francés, árabe (con soporte RTL completo), hindi, chino mandarín y ruso. 551 claves cada uno, con paridad de marcadores verificada automáticamente.
- **Motor de traducción: 12 idiomas** — los 8 anteriores más italiano, alemán, japonés y suajili.

La distinción es deliberada: traducir una interfaz exige revisión humana y contexto cultural; traducir una frase puede hacerlo un servicio. Prometer 12 interfaces cuando solo hay 8 revisadas sería mentir.

La preferencia de idioma se guarda localmente y se aplica al instante, incluida la dirección del texto.

---

## Accesibilidad

Objetivo: **WCAG 2.2 AA**.

- HTML semántico (`main`, `nav`, `section`, `article`, `button`, `label`) y un enlace de salto al contenido.
- Nombre accesible en **todos** los controles, incluidas las acciones con solo icono.
- Foco visible con `:focus-visible` y anillo de contraste; navegación completa por teclado.
- Regiones `aria-live` para el estado asíncrono: resultados de búsqueda, grabación, verificación de firmas.
- Respeto a `prefers-reduced-motion` y a `prefers-contrast: more`.
- Atajos de teclado: `1`–`7` para los módulos, `/` para buscar.
- Modales y cajones con `role="dialog"`, cierre con `Escape` y foco gestionado.
- Objetivos táctiles de 42 px como mínimo y adaptación a teléfonos de 320 px.

---

## Cómo contribuir

Hay sitio para todo el mundo, y **no todo es código**. La contribución de mayor valor hoy no es un pull request: es una palabra en tu lengua, una corrección de un dato semilla por alguien que conoce esa comunidad, o una revisión de una traducción por alguien que la habla de verdad.

Empieza por **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**, que incluye:

- Puesta en marcha en 60 segundos y la prueba del modo avión.
- Los cinco principios que ninguna contribución puede romper.
- Un esqueleto completo y copiable para crear un módulo nuevo.
- Las reglas de interfaz, datos, criptografía, i18n, accesibilidad y rendimiento.
- Los comandos que tu pull request debe pasar.
- Cómo contribuir sin escribir código.

Antes de abrir un pull request:

```bash
node tools/audit.mjs    # debe salir con código 0
node tools/e2e.mjs      # debe reportar 38/38
```

---

## Hoja de ruta

Cinco fases, con métricas y riesgos honestos, en **[docs/ROADMAP.md](docs/ROADMAP.md)**.

Resumen: **nodo comunitario** y sincronización real entre dispositivos → **lenguas vivas** con colaboración de comunidades y lingüistas → **verificación con consecuencias** publicada para revisión académica → **infraestructura cívica** en municipios, clínicas y escuelas → **sostenibilidad** con financiación que no corrompa los incentivos.

Y una lista explícita de lo que **no** vamos a hacer: publicidad, optimización del tiempo en pantalla, rastreo del comportamiento, venta de datos, escasez artificial, especulación con cadenas de bloques y cualquier función que exija una cuenta.

---

## Privacidad: qué hace PANGEA con tus datos

**Nada.** Literalmente.

| Pregunta | Respuesta |
|---|---|
| ¿Se envía algo a un servidor de PANGEA? | No existe tal servidor. |
| ¿Hay analítica? | No. |
| ¿Hay rastreadores? | No. No se carga ninguna fuente ni script de terceros salvo las bibliotecas que los módulos usan bajo demanda, y todas están cacheadas por el Service Worker. |
| ¿Se piden cuentas? | No. Tu identidad es un par de claves en tu dispositivo. |
| ¿A dónde van mis datos? | A IndexedDB, en tu dispositivo, y a los archivos que tú exportes. |
| ¿Qué sale del dispositivo y cuándo? | Solo lo que provocas explícitamente: una traducción (envía el texto a una API pública de traducción), una consulta a verificadores externos (si configuras una clave) o una sincronización con tu propio nodo comunitario. Nada más. |
| ¿Puedo ver lo que se registra? | Sí. Ajustes → Telemetría ética muestra el contador local de uso, y puedes borrarlo. **Nunca se exporta:** ni siquiera viaja en tu propio pasaporte ni en una sincronización con un nodo comunitario. |
| ¿Puedo borrarlo todo? | Sí. NEXUS ID → Borrar todos mis datos. |
| ¿Puedo llevármelo? | Sí. Pasaporte PANGEA: un ZIP firmado con tu identidad, tu reputación y todas tus contribuciones. |

---

## Créditos y licencia

**PANGEA** nació como una declaración antes que como un producto: la tecnología puede y debe usarse para conectar a la humanidad, no para dividirla. Cada línea de este repositorio intenta reflejar esa convicción.

- **Código:** [MIT](LICENSE). Úsalo, modifícalo, véndelo, mejóralo. Solo pedimos que la versión que mejores siga siendo útil para quien más la necesita.
- **Contenido** (saberes, palabras, traducciones, datos semilla): Creative Commons **BY-SA 4.0**. El conocimiento preservado pertenece a las comunidades que lo generaron y debe seguir siendo compartible.
- **Datos semilla de lenguas originarias:** material ilustrativo que **debe validarse con hablantes nativos** de cada pueblo antes de tomarse como referencia. Se marca como *Demostración* en la interfaz a propósito.

Hecho con HTML, CSS y JavaScript nativos. Sin frameworks, sin paso de compilación, sin servidores y sin dueño.

> Si tienes que elegir entre más funciones y más impacto humano, elige siempre el impacto humano.
