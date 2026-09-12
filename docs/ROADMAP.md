# Hoja de ruta de PANGEA

Cinco años, siete fases y una lista explícita de lo que no vamos a hacer.

Este documento intenta ser ambicioso y honesto al mismo tiempo. Ambicioso,
porque el problema lo exige. Honesto, porque una hoja de ruta que promete más de
lo que el código hace hoy no sirve para coordinar a nadie: sirve para vender.
Cada afirmación sobre el estado actual se puede comprobar en el repositorio y
con los dos comandos de verificación (`node tools/audit.mjs` y
`node tools/e2e.mjs`).

---

## 1. La apuesta

La Revolución Industrial reemplazó el músculo humano. La Revolución Digital
reemplazó el cálculo humano. La revolución que falta tiene que reemplazar el
**aislamiento** humano.

Hoy tenemos ocho mil millones de mentes y no sabemos coordinarlas. No por falta
de inteligencia, sino porque el coste de coordinación —entender al otro,
encontrarlo, confiar en él, coincidir en el mismo canal— sigue siendo
demasiado alto para casi todo el mundo. Ese coste no es una ley de la
naturaleza: es una consecuencia de las herramientas que tenemos, y las
herramientas se pueden cambiar.

**La tesis medible es esta: si el coste de coordinación tiende a cero, la
restricción que limita resolver un problema local deja de ser la información y
pasa a ser la voluntad.** Cuando encontrar a quien sabe, entender lo que dice y
verificar que es cierto cuesta casi nada, lo único que puede impedir que un
problema se resuelva es que nadie quiera resolverlo. Eso es un objetivo
alcanzable, y también es comprobable: en un mundo así, el número de
colaboraciones reales completadas deja de estar limitado por el acceso a la
información y empieza a estar limitado por la decisión de las personas.

PANGEA es una apuesta a que ese desplazamiento se puede provocar con software
libre, sin servidores, sin cuentas y sin conexión. Y una apuesta a que, si se
consigue, los primeros beneficiados serán quienes hoy tienen menos acceso: no
quien tiene el mejor teléfono, sino quien tiene un problema real y ningún canal
para resolverlo.

---

## 2. Estado actual (v1.0)

La versión 1.0 existe y funciona. No es una maqueta, y tampoco es un producto
maduro. Esto es exactamente lo que hay.

### Lo que existe y está verificado

| Elemento | Estado real |
|---|---|
| **Siete módulos funcionales** | LINGUA (traducción, voz, diccionario vivo), SYNAPSE (emparejamiento problema↔capacidad con puntuación explicable), VERITAS (verificación colectiva con evidencia obligatoria), MEMORIA (archivo del conocimiento con curaduría), SOS (alertas, mapa, modo malla por archivo firmado), AGENTE (representante personal por reglas auditables), NEXUS ID (identidad descentralizada) |
| **8 idiomas de interfaz** | Español, inglés, portugués, francés, árabe (RTL completo), hindi, chino y ruso. **502 claves cada uno**, con paridad de marcadores `{…}` verificada automáticamente en cada auditoría |
| **12 idiomas de traducción** | Los ocho anteriores más italiano, alemán, japonés y suajili, con fraseo de emergencia de 14 frases que funciona sin ninguna conexión |
| **Identidad ECDSA P-256** | Par de claves generado en el dispositivo, clave pública como identificador, huella legible `PAN-XXXX-XXXX-XXXX` derivada de SHA-256, exportación cifrada `PANGEA-ID-1` (PBKDF2-SHA256 250 000 iteraciones → AES-GCM-256) y firma de cada contribución con proyección canónica. La verificación hace **dos** comprobaciones: valida la firma contra `sig.pub` y **recalcula la huella desde esa misma clave pública**, de modo que una huella declarada que no corresponda (suplantación) se rechaza |
| **PWA totalmente sin conexión** | Service Worker con cuatro estrategias de caché (armazón cache-first, datos network-first con reserva, navegación con reserva del shell, CDN stale-while-revalidate acotado), 39 recursos de armazón y 14 fuentes auto-alojadas precargadas para funcionar en la primera sesión sin red |
| **Verificación automática en navegador real** | `node tools/e2e.mjs` ejecuta la batería completa de comprobaciones (más de veinte, y el número crece con el proyecto) sobre Chrome/Edge headless vía DevTools Protocol, incluidos cortar la red **a la página y al propio Service Worker**, la adaptación a cuatro tamaños de pantalla, los dos temas, el árabe en modo RTL, la traducción de emergencia sin conexión en 9 idiomas distintos, que suplantar la huella declarada por el firmante se rechaza y que el pasaporte exportado no contiene secretos; sale con código 1 si alguna falla. `node tools/audit.mjs` ejecuta **20 comprobaciones estáticas** (20 correctas · 0 advertencias · 0 fallos) y sale con código 0 |
| **Sin dependencias npm** | Cero dependencias en tiempo de ejecución y en desarrollo. Todo el código es JavaScript nativo; no hay paso de compilación |
| **Sin servidores ni rastreo** | Ninguna petición sale del dispositivo si el usuario no la provoca. La única telemetría es un contador local que se puede ver y borrar |

### Lo que es demostración, límite conocido o marcador de posición

| Elemento | Estado honesto |
|---|---|
| **Nodo comunitario** | El camino está escrito y **unificado**, pero el servidor no existe. El botón «Sincronizar» llama a `syncNow()`, que habla con el nodo a través de `nodeRequest()`, y `nodeRequest()` es quien instancia `js/workers/sync.worker.js`: los dos comparten **un solo contrato** (`POST {nodo}/pangea/sync` para subir, `GET {nodo}/pangea/sync?since=…` para bajar, `GET {nodo}/pangea/health` para comprobar que responde, con `Authorization: Bearer {token}` opcional). Lo que **no** hay todavía es implementación de nodo, ni autenticación obligatoria, ni resolución de conflictos. El paquete que se envía ya no lleva secretos: sale de `Store.exportAll()`, que excluye la colección `identity` y filtra las preferencias sensibles. PANGEA funciona entero sin nodo |
| **Salto físico del modo malla** | El paquete firmado `pangea-sos` se genera, se exporta, se importa y se verifica de verdad, y transporta **alertas y respuestas** (quién ofrece qué recurso), no solo alertas. El traslado por USB, radio o SMS ocurre fuera del navegador: PANGEA lo explica, no lo simula |
| **Lengua de señas** | Reconocedor de 8 posturas estáticas de la mano con MediaPipe. No es un intérprete de lengua de señas: la lengua de señas es gramatical y tridimensional |
| **Calidad de traducción** | Depende de una API pública sin clave (MyMemory) o de un nodo propio opcional. Sin red, solo el fraseo local de 14 frases curadas a mano |
| **Sincronización entre dispositivos** | Hoy se hace con el Pasaporte PANGEA: un ZIP firmado que se exporta y se importa, con estrategia de última escritura gana y detección de duplicados por `id`. El paquete de datos **excluye la colección `identity`** (`Store.NEVER_EXPORTED` la marca, junto con la telemetría, que no se transporta nunca) y **filtra las preferencias sensibles** (`pref.llm.key`, `pref.translate.endpoint.token`): la clave privada viaja solo en el sobre cifrado `PANGEA-ID-1`, y el manifiesto lleva la huella y la clave pública, nunca la privada. Un paquete con un `format` ajeno se rechaza en lugar de importarse por la vía genérica |
| **Identidad multidispotivo** | Existe **un** par de claves por dispositivo. No hay rotación, ni revocación, ni varios dispositivos bajo una misma identidad |
| **Datos semilla** | 6 problemas, 7 capacidades, 5 saberes, 3 afirmaciones y 8 palabras de lenguas originarias, **ilustrativos**, marcados como *Demostración* en la interfaz y pendientes de validación con hablantes nativos |
| **Cobertura de navegadores** | Verificado a fondo en Chromium (Chrome/Edge). Safari/iOS, Firefox y hardware de gama muy baja están pendientes de prueba |
| **Estándar abierto** | Existen formatos versionados (`pangea-exchange`, `pangea-passport`, `pangea-sos`, `pangea-memoria`, `pangea-lingua-dictionary`, `pangea-synapse`, `pangea-veritas-claim`, `PANGEA-ID-1`) y su especificación normativa está escrita en `docs/PROTOCOLO-PANGEA.md` (codificación canónica, sobre de firma, esquema de cada colección, niveles de conformidad y un ejemplo verificado paso a paso). Lo que **no** existe todavía es una suite de conformidad automática con vectores de prueba que un tercero pueda ejecutar en su propio lenguaje |
| **Accesibilidad** | El objetivo es WCAG 2.2 AA y hay una lista de comprobación aplicada en el código. **No** hay certificación de terceros ni pruebas con usuarios reales de tecnología de asistencia |

En resumen: la versión 1.0 demuestra que la arquitectura funciona —local-first,
sin conexión, sin servidores, verificable— y que siete módulos pueden convivir
en ella. Lo que no demuestra es que alguien la use para resolver un problema
real que no habría resuelto de otro modo. Esa es la pregunta de los próximos
cinco años.

---

## 3. Fases

Siete fases. La primera describe lo que **ya existe y está verificado**; las demás
son trabajo por hacer, y ninguna se presenta como hecha. Las fases no son
estrictamente secuenciales —hay un flujo transversal, el de las lenguas vivas,
que empieza hoy y no termina nunca— pero sí marcan el orden en que tiene sentido
construir: primero que funcione en un solo dispositivo, después que dos se
hablen, y solo entonces la escala.

### Fase 1 · MVP local (hecho)

**Objetivo.** Que una persona sola, sin conexión y sin cuenta, pueda hacer algo
útil con esto hoy mismo.

**Estado: construido y verificado.** Los siete módulos funcionan; la identidad
ECDSA se genera en el dispositivo; las firmas se verifican tras pasar por
IndexedDB; una alteración del contenido invalida la firma; suplantar la huella
del firmante se rechaza; el pasaporte exportado no contiene secretos; el modo sin
conexión funciona con la red cortada a la página *y* al Service Worker; la
interfaz se adapta a 320, 390, 768 y 1440 píxeles; el árabe se escribe de derecha
a izquierda; y las ocho lenguas de la interfaz están completas. La comprobación
automática en un navegador real recorre además los flujos manuales completos:
publicar un problema, publicar una capacidad, obtener un emparejamiento,
publicar una afirmación, votarla con evidencia, preservar conocimiento, emitir
una alerta y exportar e importar el paquete entero.

**Lo que queda en esta fase**, y es lo que de verdad la cierra: que alguien que
no sea su autor lo use una semana para un problema real. Todo lo demás es
discutible hasta que eso ocurra.

**Métrica de éxito.** Una comunidad —un puesto de salud, un comité de agua, una
brigada— usa la aplicación durante una semana para algo que le importaba y
vuelve a usarla la semana siguiente.

**Riesgo honesto.** Que esté muy bien construido y no lo use nadie. Es el riesgo
más probable de todos los que aparecen en este documento.

### Fase 2 · Sincronización entre nodos (0–6 meses)

**Objetivo.** Convertir el marcador de posición de sincronización en un nodo
autoalojable de verdad, y que dos dispositivos puedan intercambiar registros sin
perder nada.

**Entregables concretos**

1. **Un contrato de nodo único y publicado — hecho.** Ya hay una sola
   convención, no dos: `POST {nodo}/pangea/sync` para subir,
   `GET {nodo}/pangea/sync?since=…` para bajar y `GET {nodo}/pangea/health`
   para comprobar que responde, con `Authorization: Bearer {token}` opcional.
   `syncNow()` (el botón «Sincronizar») habla con el nodo a través de
   `nodeRequest()`, y `nodeRequest()` es quien instancia el worker: los dos
   caminos cumplen el mismo contrato. El antiguo `POST {nodo}/pangea/alerts` ya
   no existe. Lo que queda es publicarlo como parte formal de la especificación
   del protocolo, donde hoy figura como interfaz no normativa.
2. **Nodo de referencia desplegable** sobre almacenamiento compatible con
   PocketBase, Supabase o CouchDB, con guía de instalación, copia de seguridad y
   operación. El nodo **no es una autoridad**: almacena registros tal y como
   llegan, con `id`, `createdAt`, `author` y `sig`, y cualquiera puede
   verificarlos sin confiar en él.
3. **Resolución de conflictos para escrituras sin conexión** mejor que la actual
   última-escritura-gana: versionado por registro y fusión determinista según el
   tipo de dato (los hechos aditivos —confirmaciones, votos, curaciones— se
   acumulan; el estado escalar se reemplaza), con reglas publicadas y
   reproducibles.
4. **Identidad en varios dispositivos** sin copiar la clave privada entre ellos:
   subclaves de dispositivo atestadas por la clave raíz, o transferencia
   explícita del sobre cifrado, con revocación de dispositivos.
5. **Primera interoperabilidad con el transporte malla**: códigos QR para
   transferir un paquete firmado sin ninguna red, importación desde USB o
   tarjeta SD, y definición del formato para pasarelas SMS.
6. **Pruebas**: un E2E de dos nodos en el arnés de pruebas, con corte de red
   deliberado, y vectores de conflicto documentados.

**Trabajo técnico.** Protocolo de sincronización incremental (marca de tiempo o
vector de versiones), almacén de blobs para paquetes grandes, autenticación
opcional frente al nodo (el cliente ya envía un `Bearer` opcional si el usuario lo
configura; lo que no existe es un servidor que lo compruebe), resolución de
conflictos determinista, y una prueba de estrés de importación/exportación que
garantice que la firma sigue verificando después de cada ida y vuelta.

**Métrica de éxito.** Dos dispositivos, ambos sin conexión, intercambian un
conjunto de registros y convergen al mismo estado sin pérdida ni duplicados,
demostrado por una prueba automática y reproducible; y una persona ajena al
proyecto levanta su propio nodo en menos de 30 minutos siguiendo solo la
documentación.

**Riesgo honesto.** Que nadie despliegue el nodo. Un nodo es un servidor, y un
servidor tiene dueño, coste, responsabilidad legal y superficie de ataque; la
mayoría de las comunidades no quiere administrar uno. Mitigación: que el nodo
sea opcional de verdad y que su ausencia no reste ninguna capacidad local. Riesgo
residual: la federación no elimina el poder —quien aloja el nodo puede censurar
por omisión— y no hay forma de evitar eso sin volver a un servidor central.

---

### Flujo transversal · Lenguas vivas (empieza ya, no termina nunca)

Este trabajo no es una fase: atraviesa todas. Cada lengua que se documenta es una
lengua que alguien puede seguir usando, y eso no espera a que la infraestructura
esté lista. Lo que sí cambia por fase es la escala: primero un diccionario en un
teléfono, después diccionarios que se federan entre comunidades.

**Objetivo.** Que el Diccionario Vivo sea una herramienta de recuperación
lingüística para las comunidades que lo usan, no un recuerdo bonito recogido por
otros.

**Entregables concretos**

1. **Colaboración real con comunidades indígenas y lingüistas**: acuerdos
   explícitos, alfabetización de los acuerdos y acompañamiento, con la comunidad
   decidiendo qué se publica y qué no.
2. **Grabación de audio con hablantes nativos** como parte central del flujo (hoy
   cada palabra admite audio de pronunciación y variante dialectal): captura,
   recorte, compresión, reproducción y almacenamiento local con control de cuota.
3. **Modelo de moderación comunitaria**: quién puede corregir una palabra, qué
   pasa cuando dos variantes dialectales discrepan, cómo se representa la
   ortografía de cada comunidad y cómo se retira algo sin borrar la historia.
4. **Intercambio federado de diccionarios**: especificación formal del formato
   `pangea-lingua-dictionary` con procedencia, licencia por colección y fusión de
   aportaciones sin perder autoría.
5. **Registro de consentimiento firmado**: cada grabación con su consentimiento,
   su licencia y su alcance, verificable y exportable por la comunidad.

**Trabajo técnico.** Modelo de datos léxico que soporte variantes, dialectos,
prosodia y ortografías alternativas; almacenamiento de audio fuera de los
registros firmados (los blobs grandes no deberían viajar dentro de una firma);
fusión de diccionarios con procedencia y detección de conflictos; y, si se
aborda el reconocimiento de voz, modelos pequeños por lengua descargados bajo
demanda y cacheados, siempre con alternativa textual.

**Métrica de éxito.** Número de lenguas con un núcleo de vocabulario grabado por
hablantes nativos y **validado por esa misma comunidad**; y número de comunidades
que adoptan PANGEA como archivo propio, no número de palabras recogidas.

**Riesgo honesto.** El extractivismo. Un equipo externo y bienintencionado
construyendo una base de datos de lenguas ajenas puede repetir, con mejores
modales, el mismo saqueo que dice combatir: el archivo queda en servidores que la
comunidad no controla y sirve para entrenar modelos con los que nadie contó.
Mitigación: codesarrollo, moderación en manos de la comunidad, licencia y
exportación por comunidad, y consentimiento por grabación. Riesgo residual: aun
con consentimiento, un archivo abierto puede usarse en contra de los intereses de
quienes lo cedieron, y las licencias abiertas no lo impiden del todo.

---

### Fase 3 · Red P2P (6–18 meses)

**Objetivo.** Que dos dispositivos que se encuentran físicamente puedan
intercambiar registros sin ningún servidor de por medio, ni siquiera el nodo
comunitario de la fase anterior.

**Estado: no existe nada de esto.** Hoy el transporte entre dispositivos es un
archivo que una persona mueve a mano: funciona —está verificado, y es lo que
permite que la alerta de SOS viaje por USB o por radio— pero exige que alguien lo
lleve. Esta fase quita esa exigencia cuando los dispositivos están cerca.

**Trabajo técnico.** WebRTC con descubrimiento local por mDNS o por código QR
intercambiado en pantalla; sincronización por *gossip* con relojes vectoriales
para resolver el orden de los cambios sin autoridad central; transporte tolerante
a demoras (el modelo DTN, el de las redes interplanetarias, que asume que la
conexión se corta y vuelve); y transporte por radio de paquetes pequeños, que es
donde el formato PKE ya juega a favor porque un registro firmado cabe en un
mensaje de texto.

**Métrica de éxito.** Dos teléfonos en modo avión, a diez metros, intercambian
una alerta y un emparejamiento sin tocar ningún archivo a mano y sin internet.

**Riesgo honesto.** El descubrimiento local y el consumo de batería son difíciles
de hacer bien, y las API del navegador para esto cambian cada año. Existe el
riesgo real de construir algo que solo funciona en el navegador donde se probó.

### Fase 4 · Agentes IA (12–24 meses)

**Objetivo.** Que el agente personal deje de aplicar seis reglas fijas y pase a
razonar sobre los emparejamientos, sin dejar de ser auditable y sin dejar de
funcionar sin él.

**Estado: hoy es un motor de reglas.** Las seis reglas están a la vista del
usuario, con sus pesos, y eso es deliberado: se puede discutir con un algoritmo
que se entiende. Nada de lo actual depende de un modelo de lenguaje.

**Trabajo técnico.** Integrar un modelo local (Ollama, llama.cpp) o un endpoint
compatible con la API de OpenAI, siempre **opcional**: la aplicación debe seguir
siendo completa sin ningún modelo. Redactar mensajes de propuesta de colaboración
a partir del contexto del emparejamiento. Explicar en lenguaje natural por qué
dos registros encajan, partiendo de las razones que el motor de reglas ya
produce. Y una regla que no se negocia: **el agente nunca debe decidir por la
persona**, solo preparar la decisión y presentarla.

**Métrica de éxito.** Una persona acepta o rechaza una sugerencia del agente
entendiendo por qué se le hizo, y puede decir en una frase qué la convenció.

**Riesgo honesto.** Que el modelo invente contexto, que consuma recursos que el
dispositivo no tiene, o que introduzca una dependencia que rompa la promesa de
funcionar sin conexión y sin servidores. Los tres se mitigan manteniéndolo
opcional y local, pero el riesgo de que se filtre como requisito es real.

### Fase 5 · Red global distribuida (18–36 meses)

**Objetivo.** Que el consenso de VERITAS signifique algo fuera de la aplicación, y
que nodos de distintas comunidades —y de distintas implementaciones del
protocolo— puedan federarse sin una autoridad central.

**Entregables concretos**

1. **Grafos de evidencia**: las fuentes pasan a ser registros de primera clase,
   con su propia procedencia, enlazadas entre sí y firmadas, en lugar de texto
   libre dentro de un voto.
2. **Credibilidad de fuentes sin autoridad central**: evaluaciones firmadas y
   portables, sin una puntuación global única, de modo que nadie pueda comprar el
   puesto número uno de una lista.
3. **Integración con verificadores profesionales mediante el protocolo abierto**,
   en las dos direcciones: publicar afirmaciones hacia ellos e ingerir sus
   veredictos como evidencia firmada y atribuida, no como verdad revelada.
4. **Publicación del algoritmo de consenso para revisión académica por pares**,
   con los datos y el código congelados: pesos de voto (verdadero `+1`, falso
   `−1`, falta contexto `+0.35`, no verificable `0` y excluido del denominador),
   sello de consenso con 5 votos o más y 66 % de acuerdo, índice de credibilidad
   de 0 a 100 y detector de anomalías (ventana de ráfaga de 90 s, fuego rápido de
   20 s, ratio de diversidad de evidencia por debajo de 0,4).

**Trabajo técnico.** Direccionamiento por contenido para fuentes y evidencias;
atestaciones firmadas por quien evalúa una fuente; resistencia a identidades
sintéticas sin registro central; reproducibilidad (corpus congelado y una
implementación de referencia del cálculo); y una regla de «sin evidencia no hay
voto» que sobreviva a la importación de paquetes de terceros.

**Métrica de éxito.** Número de afirmaciones cuyo consenso ha sido reproducido
independientemente por un tercero a partir de datos exportados; número de
verificaciones profesionales enlazadas; y una publicación revisada por pares que
reproduzca los números del algoritmo.

**Riesgo honesto.** La verificación sin consecuencias es teatro, y la
verificación con consecuencias puede ser censura: quien decide los pesos decide
qué cuenta como verdadero. Mitigación: publicar el algoritmo, no borrar nunca una
afirmación, permitir que cualquiera recalcule el consenso con los votos y las
evidencias exportadas, y mostrar siempre la composición del consenso (qué
huellas votaron y con qué evidencia). Riesgo residual: un grupo coordinado con
muchas identidades puede imponer su versión de un hecho, porque la resistencia a
los ataques Sybil sin autoridad central es un problema abierto.

---

### Fase 6 · Infraestructura humanitaria (36–60 meses)

**Objetivo.** Dejar de ser una aplicación que la gente prueba y convertirse en
infraestructura que municipios, clínicas y escuelas usan a diario.

**Entregables concretos**

1. **Despliegues con municipios, clínicas y escuelas**, con operadores locales
   formados, funcionamiento sin conexión por defecto y custodia local de los
   datos: los registros son de la institución y de las personas, no del proyecto.
2. **Certificación de accesibilidad** frente a WCAG 2.2 AA por un tercero y
   pruebas con usuarios reales de tecnologías de asistencia, incluidos lectores
   de pantalla y navegación solo por teclado.
3. **Integración con radio malla**: llevar los formatos firmados de PANGEA a
   pasarelas LoRa o radio de paquetes, porque el salto físico es lo único que un
   navegador no puede dar por sí solo.
4. **Un estándar abierto formal** para que otras aplicaciones interoperen con
   registros PANGEA. La especificación normativa ya está escrita
   (`docs/PROTOCOLO-PANGEA.md`: proyección canónica, sobre de firma, esquemas de
   las colecciones y niveles de conformidad); el trabajo de esta fase es
   convertirla en un estándar con vida propia: versión estable, suite de
   conformidad ejecutable y vectores de prueba que cualquier implementación
   pueda verificar sin ejecutar este código.
5. **Manual del operador**: instalación, copias de seguridad, sustitución de
   dispositivos y recuperación de la identidad sin depender del proyecto.

**Trabajo técnico.** Especificación con vectores de prueba y política de
compatibilidad hacia atrás; suite de conformidad que un tercero pueda ejecutar;
internacionalización de los textos legales y de consentimiento; herramientas de
operación pensadas para personal no técnico; y estrategia de custodia a largo
plazo de las claves privadas (copias en papel, dispositivos dedicados), que hoy
son un archivo cifrado y una contraseña.

**Métrica de éxito.** Número de instituciones que llevan más de 12 meses en
producción sin depender del equipo original; número de implementaciones
independientes que pasan la suite de conformidad; y número de registros
intercambiados entre aplicaciones distintas.

**Riesgo honesto.** La captura institucional. El proyecto se convierte en
proveedor, la hoja de ruta se dobla hacia quien firma el contrato y
«infraestructura cívica» acaba siendo un programa piloto con logotipo. Además,
la dependencia de un puñado de mantenedores es un riesgo real de continuidad.
Mitigación: cláusulas de interés público en los contratos, despliegues
publicados, ninguna funcionalidad que exista solo para un cliente, gobernanza con
las comunidades dentro y documentación pensada para que el proyecto sobreviva a
quien lo empezó. Riesgo residual: la burocracia de la contratación pública puede
llegar a definir el producto más que las necesidades de la gente.

---

### Fase 7 · Ecosistema global de inteligencia colectiva (continua)

**Objetivo.** Que la coordinación deje de depender de quién tiene mejor conexión,
y que este programa sea una pieza más —no la única— de esa infraestructura. Esta
fase es un horizonte, no un plan: se escribe para que las decisiones de hoy no la
hagan imposible.

**Objetivo.** Que el proyecto pueda seguir existiendo sin traicionar sus
incentivos, y que las comunidades que lo usan tengan voz real sobre él.

**Entregables concretos**

1. **Financiación que no corrompe los incentivos**: subvenciones de interés
   general, contratos de infraestructura pública y donaciones. Sin publicidad,
   sin venta de datos, sin capital que exija crecimiento.
2. **Gobernanza con las comunidades**: un órgano donde quien usa PANGEA —no solo
   quien lo escribe— decide sobre el protocolo, los datos del diccionario y del
   archivo, y con veto sobre lo que afecte a sus propios registros.
3. **Auditoría de seguridad externa** de la criptografía, el almacén, el Service
   Worker y las rutas de importación, con un modelo de amenazas publicado. Las
   claves privadas viven en el dispositivo: una inyección de código en la página
   es un robo de identidad. Esta fase no empieza de cero y no debería servir para
   descubrir lo que ya se sabe: durante el desarrollo se encontraron y se
   corrigieron **dos defectos concretos** —la huella del firmante se aceptaba sin
   recalcularla desde su clave pública (suplantación de autoría, hoy rechazada por
   la segunda comprobación de `Crypto.verify()`), y las copias de seguridad
   exportadas podían incluir la clave privada en claro (hoy la colección
   `identity` se excluye por omisión de todo paquete de datos)—. Una auditoría
   externa debería poder verificar de forma independiente que esas dos clases de
   fallo están cerradas y si queda alguna hermana.
4. **Sostenibilidad del mantenimiento**: presupuesto explícito para trabajo
   aburrido (revisar traducciones, mantener dependencias externas, arreglar
   accesibilidad) y no solo para funciones nuevas.
5. **Contabilidad pública**: de dónde viene el dinero y en qué se gasta, con la
   misma transparencia que se exige al código.

**Métrica de éxito.** Años de autonomía financiera con fuentes diversificadas y
ningún financiador por encima de un tercio del total; y un órgano de gobernanza
en el que las comunidades usuarias tienen capacidad real de bloqueo sobre las
decisiones que afectan a sus datos.

**Riesgo honesto.** El dinero cambia lo que se construye incluso cuando no compra
una función: cambia la conversación, el vocabulario y las prioridades. Además,
las subvenciones premian la novedad y castigan el mantenimiento, que es
exactamente lo que un proyecto así necesita. Mitigación: presupuestar el
mantenimiento y la traducción como trabajo de primera clase, y publicar las
cuentas. Riesgo residual: el agotamiento de las personas que sostienen el
proyecto no se arregla con gobernanza ni con auditorías.

---

## 4. Lo que NO vamos a hacer

Esta sección es una promesa. Por eso cada negativa se explica en una frase y se
limita a cosas que dependen de nosotros.

| Nunca | Por qué |
|---|---|
| **Publicidad** | Un modelo de negocio publicitario exige captar atención y perfilar personas, que es exactamente lo contrario de una capa de coordinación |
| **Optimización del tiempo en pantalla** | Si el objetivo es que dos personas resuelvan un problema, el éxito se mide cuando cierran la aplicación, no cuando se quedan |
| **Rastreo del comportamiento** | No habrá analítica, ni identificadores de dispositivo, ni mapas de calor: no se puede mejorar un producto traicionando a quien lo usa |
| **Vender datos** | No existen datos que vender: no hay servidor que los reciba y los registros son de quien los escribe |
| **Escasez artificial** | Ninguna función se bloquea tras un pago, un límite de uso o una lista de espera: la escasez en una herramienta de coordinación es una traición a su propósito |
| **Especulación con cadenas de bloques** | No habrá token, ni preventa, ni «economía de incentivos» que convierta la resolución de problemas reales en un mercado de expectativas |
| **Funciones que exijan una cuenta** | La identidad es un par de claves en tu dispositivo y no hay registro: si algo necesita que alguien te autorice a usarlo, no entra en PANGEA |

Añadimos una más, que no es una función sino una actitud: **no vamos a prometer
lo que no hemos probado.** Cuando algo sea una demostración, se dirá que es una
demostración. Cuando no lo hayamos medido, no lo pondremos en una diapositiva.

---

## 5. Métricas que importan

PANGEA no tiene analítica, y no va a tenerla. Eso tiene una consecuencia
incómoda: **estas métricas no se pueden medir a escondidas.** No salen de un
panel de control, salen de que las comunidades y los nodos que quieran las
reporten de forma voluntaria y agregada, o del recuento local que cada persona
puede ver y borrar en Ajustes.

| Lo que optimizamos | Cómo se reconoce (cuando alguien lo reporta) |
|---|---|
| **Colaboraciones reales completadas** | Emparejamientos que pasan de sugerido a *en colaboración* y luego a *resuelto*, con al menos dos huellas distintas participando |
| **Problemas resueltos** | Problemas que se cierran porque algo cambió fuera de la aplicación, no porque alguien marcó una casilla |
| **Lenguas preservadas** | Lenguas con vocabulario grabado por hablantes nativos, validado por esa comunidad y exportado por ella |
| **Alertas atendidas** | Alertas de SOS con respuesta de recursos y confirmaciones de personas distintas |
| **Sesiones sin conexión servidas** | Veces que PANGEA hizo su trabajo con la red cortada, que es la prueba de que no depende de nadie |
| **Implementaciones independientes** | Aplicaciones o nodos de terceros que leen, escriben y verifican registros PANGEA sin ejecutar este código |

| Lo que nos negamos a optimizar | Por qué |
|---|---|
| **Tiempo en la aplicación** | Un problema resuelto en dos minutos vale más que una sesión de cuarenta; optimizar tiempo de uso premia exactamente lo contrario |
| **Usuarios activos diarios** | La gente tiene problemas de forma intermitente; un mes sin abrir PANGEA puede significar que todo va bien |
| **Sesiones por usuario** | Mide costumbre, no impacto, y empuja hacia notificaciones que solo existen para traer de vuelta |
| **Retención y «engagement»** | Son vocabulario de captura de atención: en una herramienta de coordinación, retener a alguien es un fallo del producto |

La diferencia es de dirección, no de grado. Las métricas que nos importan
describen **algo que ocurrió en el mundo**: dos personas que no se conocían
resolvieron un problema, una lengua quedó registrada, una alerta recibió
respuesta. Las que rechazamos describen **cuánto tiempo retuvo el software a una
persona**. Las primeras pueden bajar a cero y eso puede ser un éxito —significa
que no hacía falta usarnos—; las segundas solo crecen haciendo que la gente se
quede, y por eso no las queremos ni aunque fueran fáciles de medir. No lo son:
sin analítica, no habría forma de calcularlas ni queriendo.

---

## 6. Cómo participar en cada fase

| Perfil | Dónde tu aportación importa más | Qué hacer en concreto |
|---|---|---|
| **Desarrollador/a** | Fase 2 (sincronización entre nodos) y Fase 3 (red P2P) | Levantar el nodo autoalojable, escribir la fusión de conflictos y las pruebas de dos nodos (el contrato de nodo ya está unificado: queda implementarlo del lado del servidor). Después, el transporte tolerante a demoras y el descubrimiento local |
| **Traductor/a o lingüista** | **Ahora mismo**, y el flujo transversal de lenguas vivas | Revisar las 551 claves de tu idioma en `js/locales/`, aportar palabras al Diccionario Vivo con audio, y ayudar a definir el modelo de variantes dialectales y ortografías |
| **Experto/a de dominio** (salud, agua, energía, derecho, agricultura) | Fase 1 y Fase 6 | Curar MEMORIA con firma, verificar afirmaciones con evidencia real, y revisar la taxonomía y los datos semilla de tu ámbito antes de que alguien los use en campo |
| **Organizador/a comunitario** | Fase 1 y el flujo transversal de lenguas vivas | Definir quién modera el diccionario y el archivo de tu comunidad, decidir la licencia y el consentimiento, y pilotar un despliegue en una escuela, una clínica o un municipio |
| **Financiador/a** | Fase 7, y lo aburrido de todas las demás | Pagar mantenimiento, traducción, accesibilidad y auditoría de seguridad antes que funciones nuevas. Los contratos de infraestructura pública valen más que las subvenciones de novedad |
| **Especialista en accesibilidad o seguridad** | Transversal, con hitos claros en Fase 1 y Fase 6 | Auditar la interfaz con lectores de pantalla y teclado; revisar la criptografía, el Service Worker y las rutas de importación antes de que las use una institución |

---

## 7. Riesgos y cómo los mitigamos

| Riesgo | Mitigación honesta | Riesgo residual |
|---|---|---|
| **Fallo de coordinación**: el software funciona y no hay nadie dentro; PANGEA se convierte en una aplicación vacía y elegante | Datos semilla para que la red nunca esté vacía al abrir; emparejamiento automático que produce resultados desde el primer minuto; nodos comunitarios en lugar de una red global; y despliegues con instituciones que ya tienen problemas y personas esperando | Una herramienta vacía no se usa dos veces. Ninguna cantidad de ingeniería resuelve la masa crítica: eso depende de comunidades reales, y no se puede fabricar |
| **Captura por élites**: quien tiene más tiempo, más dinero o más inglés acaba definiendo el protocolo, las traducciones y las reglas del diccionario | Gobernanza con las comunidades usuarias y veto sobre lo que afecta a sus datos; licencias abiertas; decisiones y cuentas publicadas; y ningún financiador con más de un tercio del presupuesto | La asimetría de tiempo y de idioma no desaparece por reglamento: quien asiste a las reuniones sigue influyendo más que quien no puede asistir |
| **Moderación de contenido a escala**: en cuanto hay archivos y diccionarios compartidos aparecen el spam, la desinformación y el contenido dañino, y no hay un equipo central que lo filtre | Todo es local y exportable por defecto: cada comunidad modera su colección; la evidencia es obligatoria en VERITAS; los patrones anómalos se señalan con sus números; y retirar algo no borra su historia | Sin autoridad central no hay una última instancia, y en un archivo federado alguien puede alojar contenido que otra comunidad rechaza. La moderación distribuida es más libre y más lenta |
| **Seguridad de las claves locales**: la clave privada vive en el dispositivo; una inyección de código en la página, una extensión maliciosa o un dispositivo compartido pueden robar la identidad y firmar en tu nombre | Sin terceros ni scripts remotos salvo bibliotecas detectadas en tiempo de ejecución; exportación cifrada con PBKDF2-SHA256 de 250 000 iteraciones y AES-GCM-256; Service Worker que cachea el armazón; auditoría externa prevista en la Fase 5; y huellas recalculadas siempre desde la clave pública en lugar de aceptar la declarada, para que un tercero pueda detectar suplantaciones | Un dispositivo comprometido es una identidad comprometida. No hay revocación global posible por diseño, y recuperar una identidad robada es un problema abierto |
| **Dependencia de CDN**: hoy varias funciones valiosas (mapas, búsqueda, gráficos, modelo neuronal) se apoyan en bibliotecas servidas desde CDN, que pueden desaparecer, cambiar de licencia o ser bloqueadas por una red nacional | Todas son opcionales y todas están detectadas en tiempo de ejecución, con un modo local probado: la lista ordenada por distancia en SOS, el índice propio de MEMORIA y los embeddings locales del motor semántico. La tipografía está autoalojada para no pedir nada a terceros | Los modos locales son peores que los que sustituyen, y la primera visita sin conexión en un país donde la CDN está bloqueada da una experiencia degradada. Autoalojar todo engordaría el proyecto |
| **Construir algo que nadie usa**: cinco años de trabajo, buenas intenciones y una aplicación que no cambia la vida de nadie | Empezar por problemas concretos y comunidades concretas en lugar de por una red global; métricas que miden impacto y no uso; despliegues institucionales que garantizan usuarios reales; y honestidad publicada sobre lo que es demostración | Es el riesgo más probable de todos. Un navegador sin conexión no arregla un mal canal humanitario, ni la desconfianza entre vecinos, ni la falta de voluntad política. Si el diagnóstico de la sección 1 es incorrecto —si el cuello de botella nunca fue la coordinación—, PANGEA será un ejercicio técnico bien hecho y nada más |

---

Una última nota de método, porque es la única forma de que esta hoja de ruta
siga significando algo dentro de dos años: **cada fase termina con una prueba que
puede fallar.** No «se avanzó en», sino un comando que devuelve un resultado
distinto de cero cuando no se ha conseguido. Es lo que ya hacen hoy
`node tools/audit.mjs` y `node tools/e2e.mjs` para la versión 1.0, y es lo que
pediremos a cada fase siguiente.
