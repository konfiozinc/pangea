# PROTOCOLO PANGEA

**Especificación abierta de interoperabilidad para inteligencia colectiva local-first**

| Campo | Valor |
|---|---|
| Nombre del protocolo | PANGEA |
| Versión de esta especificación | 1.0 |
| Identificador de versión en los paquetes | `spec: "1.0"` |
| Fecha | 2026-09-10 |
| Estado | Borrador normativo, derivado por transcripción de la implementación de referencia |
| Implementación de referencia | PANGEA v1.0.0 (`js/crypto.js`, `js/store.js`, `js/utils.js`, `js/app.js`, `js/modules/*.js`, `data/*.json`) |
| Licencia del código de referencia | MIT · contenido CC BY-SA |
| Dependencias normativas externas | RFC 7517 (JWK), RFC 7515 (JWS, uso parcial: firma cruda `r‖s`), RFC 8018 (PBKDF2), NIST SP 800-38D (AES-GCM), ISO/IEC 21320-1 / APPNOTE.TXT (ZIP) |

> **Aviso de origen.** Todos los nombres de campo, alfabetos, listas de exclusión, recuentos de iteraciones, umbrales y formatos de archivo de este documento fueron copiados del código fuente de la implementación de referencia, no inferidos. Donde el código y la expectativa razonable de un implementador difieren, este documento describe **lo que el código hace** y lo señala explícitamente. Las divergencias conocidas se listan además en el [Apéndice D](#apéndice-d--divergencias-conocidas-con-la-implementación-de-referencia-no-normativo).

---

## Convenciones normativas

Las palabras clave **DEBE**, **NO DEBE**, **DEBERÍA**, **NO DEBERÍA**, **PUEDE** y **OPCIONAL** se interpretan según RFC 2119:

| Término | Significado en este documento |
|---|---|
| **DEBE** / **NO DEBE** | Requisito absoluto. Una implementación que no lo cumpla no es conforme en el nivel declarado. |
| **DEBERÍA** / **NO DEBERÍA** | Recomendación fuerte. Puede ignorarse con una razón documentada y comprensible. |
| **PUEDE** / **OPCIONAL** | Elección libre del implementador sin impacto en la conformidad. |
| `MUST` / `SHOULD` / `MAY` | Equivalentes ingleses de DEBE / DEBERÍA / PUEDE; se usan solo en las tablas de requisitos para facilitar la traducción. |

Toda la información de este documento es **normativa** salvo lo que aparezca en un apartado titulado «**No normativo**» o «**En desarrollo**».

---

## Índice

1. [Alcance y motivación](#1-alcance-y-motivación)
2. [Terminología](#2-terminología)
3. [Codificación canónica (JSON-C PANGEA)](#3-codificación-canónica-json-c-pangea)
4. [Identidad (NEXUS ID)](#4-identidad-nexus-id)
5. [Identidad portátil (`PANGEA-ID-1`)](#5-identidad-portátil-pangea-id-1)
6. [Reputación portable (atestaciones)](#6-reputación-portable-atestaciones)
7. [Colecciones y esquemas](#7-colecciones-y-esquemas)
8. [Taxonomía compartida](#8-taxonomía-compartida)
9. [Paquetes de intercambio](#9-paquetes-de-intercambio)
10. [Formato de archivo ZIP propio](#10-formato-de-archivo-zip-propio)
11. [Fusión de datos (merge)](#11-fusión-de-datos-merge)
12. [Transporte sin red](#12-transporte-sin-red)
13. [Versionado y extensibilidad](#13-versionado-y-extensibilidad)
14. [Conformidad (niveles)](#14-conformidad-niveles)
15. [Consideraciones de seguridad y privacidad](#15-consideraciones-de-seguridad-y-privacidad)
16. [Apéndice A: ejemplo completo y verificación paso a paso](#apéndice-a--ejemplo-completo-y-verificación-paso-a-paso)

---

## 1. Alcance y motivación

### 1.1 Qué estandariza este documento

Este documento estandariza el **formato de los datos** y **las reglas de verificación** que permiten a dos nodos PANGEA —escritos en lenguajes distintos, ejecutados en plataformas distintas, nunca conectados a la misma red— intercambiar registros firmados y llegar a las mismas conclusiones. Concretamente:

| Área | Qué se estandariza |
|---|---|
| Proyección canónica | La función byte a byte que convierte un registro en la cadena UTF-8 que se firma (JSON-C PANGEA). |
| Identidad | El par de claves ECDSA P-256, la huella legible `PAN-XXXX-XXXX-XXXX`, y el sobre de firma `{sig, pub, fp, alg, at}`. |
| Verificación | El procedimiento exacto de verificación de firmas y sus modos de fallo. |
| Identidad portátil | El sobre cifrado `PANGEA-ID-1` (PBKDF2-SHA256/250 000 + AES-GCM-256). |
| Reputación | El objeto `pangea.attestation` y su verificación por un tercero. |
| Modelo de datos | Las 12 colecciones de contenido, sus campos, tipos y enumeraciones. |
| Taxonomía | Los 14 identificadores de categoría compartidos. |
| Paquetes | Los formatos `pangea-exchange`, `pangea-passport`, `pangea-sos`, `pangea-memoria`, `pangea-lingua-dictionary` (y los auxiliares `pangea-phrasebook`, `pangea-synapse`, `pangea-veritas-claim`). |
| Contenedor | El subconjunto ZIP de método 0 (sin compresión) que la implementación de referencia escribe y lee. |
| Fusión | La regla de conflicto «última escritura gana». |

### 1.2 Qué NO estandariza este documento (deliberadamente)

El protocolo **NO** define, y una implementación conforme **NO DEBE** asumir:

| Fuera de alcance | Razón |
|---|---|
| Almacenamiento local | La implementación de referencia usa IndexedDB, pero el protocolo solo habla de JSON. Cualquier almacén (SQLite, archivos, papel) es válido. |
| Interfaz, marca, iconografía, CSS | La interoperabilidad es de datos, no de presentación. |
| Algoritmo de emparejamiento | Los pesos y umbrales de SYNAPSE (45 semántico, 20 misma categoría, 12 términos compartidos, 10 urgencia, 8 cercanía, 5 idioma; umbral 45) son una **política** del nodo, no parte del protocolo. Dos nodos pueden puntuar distinto el mismo par y ambos ser conformes. |
| Motor de consenso | Los pesos de voto (`true=+1`, `false=−1`, `context=+0.35`, `unverifiable=0`) y el umbral de 5 votos / 66 % son política del nodo. |
| Motor de credibilidad y detector de anomalías | Política del nodo; se incluyen en el paquete `pangea-veritas-claim` como **datos auditables**, no como reglas obligatorias. |
| Transporte | El protocolo no impone HTTP, ni pub/sub, ni un esquema de red. El canal puede ser un archivo. |
| Registro central, autoridades de certificación, blockchain | No hay ninguna, por diseño. La clave pública **es** el identificador. |
| Cifrado del contenido de los registros | Los registros firmados van en claro. Solo la identidad portátil está cifrada. |

### 1.3 Objetivo de diseño

El objetivo normativo del protocolo es este escenario, y toda decisión de formato se justifica contra él:

> Dos nodos que **nunca se han visto** y que **pueden no estar conectados nunca al mismo tiempo** deben poder intercambiar registros firmados **a través de cualquier canal físico** —un archivo en una memoria USB, un código QR, un mensaje SMS, una transmisión de radio de paquetes, un disco duro llevado a pie— y, al final, **llegar a las mismas conclusiones verificables sin confiar el uno en el otro y sin pedir permiso a ningún servidor**.

De ahí se derivan cuatro consecuencias normativas:

1. **Todo paquete DEBE ser autocontenido.** Debe llevar dentro las claves públicas necesarias para verificar sus propias firmas. Un receptor sin estado previo **DEBE** poder verificar.
2. **Toda verificación DEBE ser posible sin red y sin estado compartido**, años después de la emisión.
3. **El formato DEBE sobrevivir a la reescritura por parte del receptor.** Por eso la proyección canónica excluye, en todos los niveles, los campos que la base de datos del receptor va a modificar (§3.3). Esta es la decisión de diseño más importante del protocolo.
4. **La interoperabilidad DEBE degradar, no romperse.** Un campo desconocido, una colección desconocida o una categoría desconocida **NO DEBEN** invalidar un paquete (§13).

### 1.4 No normativo / en desarrollo

Los siguientes elementos existen en la implementación de referencia pero **no forman parte del protocolo** en la versión 1.0. Una implementación conforme puede ignorarlos por completo.

| Elemento | Estado real en el código | Nota |
|---|---|---|
| Nodo comunitario de sincronización | **Marcador de posición: el contrato está definido, el servidor no existe.** Hay **una sola** definición del protocolo de nodo y los dos caminos del código la cumplen: `js/workers/sync.worker.js` implementa tres mensajes (`ping` → `GET {endpoint}/pangea/health`; `push` → `POST {endpoint}/pangea/sync`; `pull` → `GET {endpoint}/pangea/sync?since=…`, con `Authorization: Bearer {token}`), y `syncNow()` en `js/app.js` —el botón «Sincronizar» de Ajustes— hace **lo mismo**: `POST {nodo}/pangea/sync` con el **paquete `pangea-exchange` completo** (§9.1) y 15 000 ms de tiempo límite; si la respuesta trae `collections`, la importa con `Store.importAll()` (§11). El antiguo `POST {url}/pangea/alerts` con `{alerts:[…]}` **ya no existe**. Aun así, **no hay ninguna implementación de servidor, ni esquema de datos, ni resolución de conflictos del lado del servidor** en este repositorio. | **No normativo.** PANGEA no tiene servidores: esto es la interfaz que **tiene que** implementar una comunidad que despliegue su propio nodo si quiere sincronizar. Un nodo que no implemente nada de esto es plenamente conforme. |
| Telemetría ética local | `Store.track()` acumula contadores por día en la colección `telemetry`. Es **local**, visible y borrable. | **No normativo.** El protocolo prohíbe añadir telemetría a los paquetes (§15.6). |
| Traducción por red | LINGUA usa MyMemory y opcionalmente un nodo LibreTranslate propio (`POST {endpoint}/translate` con `{q, source, target, format:"text"}`). | **No normativo.** No interviene en ningún formato de intercambio. |
| Reconocimiento de señas | Demostración con MediaPipe Hands; 8 gestos estáticos. | **No normativo.** No produce registros firmados. |
| Motor neuronal de similitud | `transformers.js` MiniLM cuando hay red; si no, *hashing trick* local de dimensión 192. | **No normativo.** Afecta a la puntuación, no al formato. |

**El contrato de nodo, en una sola definición (no normativo).** Ambos caminos del código coinciden hoy, de modo que un implementador tiene un único contrato que cumplir:

| Operación | Petición | Respuesta esperada |
|---|---|---|
| Comprobar que el nodo responde | `GET {nodo}/pangea/health` con `Authorization: Bearer {token}` | Cualquier JSON válido; se usa como prueba de vida. |
| Subir el paquete | `POST {nodo}/pangea/sync` con `content-type: application/json` y el **paquete `pangea-exchange` completo** como cuerpo (§9.1) | JSON; si trae `collections`, el cliente lo importa con `Store.importAll()` (§11). |
| Descargar cambios | `GET {nodo}/pangea/sync?since={ISO-8601}` con `Authorization: Bearer {token}` | JSON con `collections` (y, si el nodo quiere, `format: "pangea-exchange"`). |

Tiempo límite en ambos caminos: **15 000 ms**. Sin nodo configurado (`pref.node` vacío) **no se hace ninguna petición**: la sincronización nunca se ejecuta sola. Un fallo de red se informa y **no** bloquea la aplicación, que sigue funcionando en local. El nodo no existe: nada de esto es obligatorio para ser conforme.

---

## 2. Terminología

| Término | Definición |
|---|---|
| **Nodo** | Cualquier unidad de software que almacena registros PANGEA y puede exportarlos o importarlos. Un teléfono, un portátil, un servidor comunitario, un script en Python. Un nodo **no** es una persona: una persona puede operar varios nodos, y un nodo puede alojar registros de varias personas. |
| **Registro** (record) | Un objeto JSON con un campo `id` y, opcionalmente, un sobre de firma `sig`. La unidad de contenido y de firma. |
| **Colección** (collection) | Un conjunto nombrado y homogéneo de registros. Los nombres están fijados en §7 y **NO DEBEN** modificarse. |
| **Sobre** (envelope) | El objeto `{sig, pub, fp, alg, at}` que acompaña a un registro firmado, o el objeto de paquete firmado completo. |
| **Proyección canónica** | La cadena UTF-8 producida por `canonical(objeto)` (§3). Es **el** objeto de la firma: se firma la proyección, no el JSON del archivo. |
| **Huella** (fingerprint) | El identificador legible `PAN-XXXX-XXXX-XXXX` derivado de SHA-256 de la cadena JWK pública (§4.2). |
| **Pasaporte** (passport) | El archivo `*.pangea.zip` que contiene `manifest.json` (firmado) + `data.json` (exportación completa) + `README.txt` (§9.2). |
| **Paquete** (package) | Un archivo o flujo con un campo `format` de nivel superior que declara su forma (`pangea-exchange`, `pangea-sos`, …). |
| **Portador** (courier) | El canal físico que transporta un paquete entre nodos: USB, Bluetooth, radio, SMS, QR, papel, persona que camina. **Término de esta especificación**; la implementación de referencia llama a esto «modo malla» y nunca usa la palabra «courier». |
| **Procedencia** (provenance) | Los campos `origin` e `importedFrom`, que el nodo **receptor** escribe al importar. **No** forman parte del contenido firmado. |
| **Verificación** | Comprobar que `sig` es una firma ECDSA P-256/SHA-256 válida sobre la proyección canónica del registro, usando la clave pública del propio sobre, **y** que la huella declarada `sig.fp`, cuando existe, es la que corresponde a esa clave pública (§4.4). |
| **No verificable** | Estado de un registro cuya firma está ausente, mal formada, o no valida. **NO** es lo mismo que «falso». |

---

## 3. Codificación canónica (JSON-C PANGEA)

### 3.1 Definición

La codificación canónica —en adelante **JSON-C PANGEA**— es una función determinista `canonical(valor) → cadena` que satisface:

1. Es **determinista**: el mismo valor lógico produce la misma cadena byte a byte, con independencia del orden en que se construyeron las claves.
2. Está **sujeta a exclusión de campos**: un único conjunto de nombres de campo se elimina de la proyección, de forma **recursiva y en todos los niveles** (§3.3).
3. Su salida se codifica en **UTF-8** antes de firmar. La firma se calcula sobre esos bytes, nunca sobre la cadena JavaScript interna ni sobre el archivo original.

> **Normativo.** Una implementación **DEBE** firmar y verificar sobre `UTF8(canonical(objeto))`. Firmar el JSON del archivo tal como está en disco (con su espaciado e indentación) **NO DEBE** hacerse nunca: la implementación de referencia escribe los paquetes con `JSON.stringify(obj, null, 2)` (con sangría) pero firma la proyección compacta.

### 3.2 Reglas de proyección

| # | Regla | Observación |
|---|---|---|
| R1 | Los objetos se proyectan a un objeto nuevo cuyas claves se ordenan **ascendentemente** con el orden por defecto de JavaScript (`Array.prototype.sort()` sobre los nombres de clave), es decir **por unidades de código UTF-16**, no por orden alfabético dependiente de configuración regional. | `"Z" (0x5A) < "a" (0x61)`; `"a" < "á"`. Los dígitos (`0x30–0x39`) van antes que las mayúsculas. |
| R2 | El ordenamiento es **recursivo**: se aplica en todos los niveles, incluidas las claves de objetos anidados y de objetos dentro de arrays. | |
| R3 | Los **arrays conservan el orden**. No se ordenan, no se deduplican, no se normalizan. | El orden de `tags`, `sources`, `parts` y `collaborators` es significativo para la firma. |
| R4 | Los valores `undefined` **se omiten** (la clave desaparece del objeto proyectado) en todos los niveles. | Ocurre, por ejemplo, con `attachments[].text: undefined` y con `status: undefined` en las capacidades. |
| R5 | `null` **se conserva** como `null`. | `location: null`, `distanceKm: null`, `importedFrom: null`. |
| R6 | `Uint8Array` y `Float32Array` se convierten en **arrays de números** mediante `Array.from(v)`. | En un `Float32Array`, cada elemento sale como el valor `float32` ensanchado a doble y serializado con la representación más corta que round-trips (p. ej. `0.1` de `float32` se serializa `0.10000000149011612`). |
| R7 | El resultado se serializa con la función de serialización JSON del lenguaje, con **estas equivalencias obligatorias**: sin espacios ni saltos de línea; comillas dobles; escape de `"`, `\` y de los caracteres de control `U+0000`–`U+001F`; los caracteres no ASCII **se emiten como UTF-8 sin escapar** (incluidos `U+2028` y `U+2029`). | La implementación de referencia no escapa el árabe, el chino ni el hindi: los emite tal cual. |
| R8 | Los números se serializan con la representación decimal más corta que round-trips al mismo valor IEEE-754 de doble precisión, sin ceros finales, sin `+`, y con `e`/`e-` en minúscula para exponentes. `NaN` e `Infinity` se serializan como `null`. | Consecuencia de `JSON.stringify`. Un `1.0` se serializa `1`. |
| R9 | Las claves con forma de índice entero (como `"0"`, `"2"`, `"10"`) se emiten **antes** que el resto de claves, en orden **numérico ascendente**, aunque el paso R1 las haya ordenado como texto. | Comportamiento del motor JavaScript al serializar objetos. Evitar claves de este tipo: son una trampa de interoperabilidad. Ejemplo verificado: `canonical({"10":"a","2":"b","b":"c","a":"d"})` → `{"2":"b","10":"a","a":"d","b":"c"}`. |
| R10 | Los valores no objeto y no array (`string`, `number`, `boolean`, `null`) se devuelven sin transformar. | |

### 3.3 Conjunto único de exclusión (`NOT_SIGNED`), aplicado recursivamente

La proyección excluye **un único conjunto** de nombres de campo, definido en `js/crypto.js` con el nombre `NOT_SIGNED`. El conjunto se aplica **de forma recursiva, en todos los niveles**: raíz, objetos anidados y objetos dentro de arrays. **No existe ningún conjunto «solo de raíz»** ni ningún parámetro que distinga niveles.

La firma acredita la **autoría del contenido**, no el ciclo de vida ni el almacenamiento del registro. Estos son los **20 nombres**, agrupados por la razón por la que se excluyen:

**Grupo 1 · Sobre de firma** (incluirlo haría la firma autorreferente)

| Campo excluido | Por qué se excluye (razón normativa) |
|---|---|
| `sig` | Es el propio sobre de firma. Incluirlo haría la firma autorreferente: habría que firmar un objeto que contiene su propia firma. Imposible por construcción. |
| `signature` | Nombre alternativo del mismo sobre, usado por el manifiesto de `pangea-memoria` (§9.4), que escribe el sobre **dos veces** (`sig` y `signature`). Si no se excluyera, el manifiesto sería imposible de verificar. |

**Grupo 2 · Metadatos de almacenamiento** (los asigna la base de datos del autor, y el receptor puede reasignarlos o reindexarlos)

| Campo excluido | Por qué se excluye (razón normativa) |
|---|---|
| `id` | Clave primaria del almacén. `Store.put` la **asigna** con `uid(prefijo)` si falta, y el receptor puede re-clavar o reindexar. Es metadato de almacenamiento, no contenido. |
| `createdAt` | Marca de tiempo de almacenamiento. `Store.put` la asigna (`Date.now()`) si falta. |
| `updatedAt` | Marca de tiempo que el almacén **reescribe en cada escritura** (`Store.put` asigna `updatedAt = Date.now()`). Cambia sin que el autor haga nada. |

**Grupo 3 · Estado y anotaciones de uso** (los mutan terceros o el propio receptor: el autor no deja de ser autor porque el estado cambie)

| Campo excluido | Por qué se excluye (razón normativa) |
|---|---|
| `status` | Campo de **ciclo de vida** que muta cualquier participante: una alerta pasa a `atendida` cuando alguien la marca resuelta, un emparejamiento recorre el tablero Kanban. |
| `confirmations` | Array de huellas que **crece** cuando terceros confirman una alerta. Lo modifican otras personas. |
| `origin` | `"local"` / `"imported"`. Lo **reescribe el receptor**: un registro que viajó como `local` se almacena como `imported`. Incluirlo invalidaría toda firma legítima en el momento de importar. |
| `importedFrom` | Huella de procedencia que **añade el receptor**. No existía cuando el autor firmó. |
| `collaborators` | Array que se amplía cuando alguien mueve un emparejamiento a `en_colaboracion`. Lo modifican terceros. |
| `seed` | Marca `true` que el nodo **añade después de leer** los datos semilla (`loadSeedData`, `loadSeeds`). El archivo semilla puede no traerla. |
| `score` | Puntuación de emparejamiento. Se **recalcula en cada nodo** y puede diferir legítimamente (motor neuronal frente a n-gramas locales). La firma debe sobrevivir al recálculo. |
| `explain` | Explicación de la puntuación (razones, porcentajes, etiquetas traducidas localmente). Depende del motor y del idioma del nodo receptor. |
| `matchedAt` | Marca de tiempo de creación o actualización local del emparejamiento. **Sin productor en el código actual: reservado preventivamente.** |
| `seenBy` | Acuses de lectura locales. **Sin productor en el código actual: reservado preventivamente.** |
| `curationAvg` | Media agregada de curadurías, recalculada localmente. **Sin productor en el código actual: reservado preventivamente.** |
| `curationCount` | Recuento agregado de curadurías, recalculado localmente. **Sin productor en el código actual: reservado preventivamente.** |

**Grupo 4 · Cachés de cálculo locales** (datos derivados, grandes y dependientes del motor del nodo)

| Campo excluido | Por qué se excluye (razón normativa) |
|---|---|
| `_vec` | Vector de incrustación local (caché del motor de similitud). **Nota: este campo no lo produce ningún módulo de la implementación de referencia actual; está reservado preventivamente.** |
| `_score` | Puntuación transitoria de búsqueda o emparejamiento. Mismo caso: reservado preventivamente, sin productor actual. |
| `local` | Datos de trabajo locales del nodo (estado de vista, banderas de sesión). Nombre deliberadamente genérico. Mismo caso: reservado preventivamente, sin productor actual. |

> **Lista normativa completa, en el orden exacto del código.** `sig`, `signature`, `updatedAt`, `_vec`, `_score`, `local`, `id`, `createdAt`, `status`, `confirmations`, `origin`, `importedFrom`, `collaborators`, `seed`, `score`, `explain`, `matchedAt`, `seenBy`, `curationAvg`, `curationCount`. Son **20 nombres**, aplicados en **todos** los niveles. Una implementación conforme **NO DEBE** ampliar ni reducir esta lista: cualquier nombre añadido o ausente produce firmas incompatibles con la referencia.

> **Fallo típico de una reimplementación.** Incluir `id`, `createdAt`, `status`, `origin`, `importedFrom` o `confirmations` en la proyección —esté la clave donde esté— produce firmas que **no verifican** contra la implementación de referencia, aunque el autor original firmara honestamente: son campos que el almacén del autor reescribió **después** de firmar, o que reescribirá el del receptor. El error simétrico es excluirlos **solo en la raíz**: entonces la misma firma verifica cuando el registro viaja suelto, pero **deja de verificar** cuando el mismo registro viaja anidado dentro de un paquete —o al revés—, porque cada contexto produce una cadena distinta (§3.4).

### 3.4 Consecuencia: la proyección es idempotente e independiente del anidamiento

Al haber **un solo conjunto recursivo**, la proyección de un valor depende únicamente del valor, nunca de dónde esté colocado. De ahí se siguen tres propiedades, todas normativas:

1. **Idempotencia.** Sea `P(x)` el objeto proyectado de `x` (§3.5). Entonces `P(P(x))` es idéntico a `P(x)`: ningún campo excluido «reaparece» en una segunda pasada, porque la exclusión se decide por el **nombre** de la clave y no por su posición. (Y `canonical()` aplicada a su propia salida —que es una cadena— la devuelve sin cambios, por la regla R10.)
2. **Independencia del anidamiento.** Un registro firmado suelto y **el mismo registro** embebido dentro de un paquete producen la **misma cadena canónica**. La proyección del registro aparece además **literalmente como subcadena** de la proyección del paquete, porque la serialización JSON es composicional.
3. **Una sola firma por contenido.** Verificar la firma de un registro no exige saber en qué contexto se firmó ni en qué nivel del documento viaja.

Ejemplo real (mismo registro, **una sola** proyección — vector completo en el [Apéndice A](#apéndice-a--ejemplo-completo-y-verificación-paso-a-paso)):

| Contexto | Campos que entran en la proyección | Longitud UTF-8 |
|---|---|---|
| `canonical(registro)` (firma propia del registro) | `author, body, category, kind, lang, location, tags, title, urgency` | 369 bytes |
| El mismo registro dentro de `alerts[]` de un paquete, proyectado por separado | **los mismos ocho campos**: `id`, `createdAt`, `status`, `origin`, `importedFrom` y `confirmations` siguen excluidos, porque la exclusión es recursiva | 369 bytes |

> **Por qué esto importa (razón normativa).** Es **precisamente** lo que hace compatibles a dos implementaciones independientes: el verificador nunca tiene que adivinar el contexto. Una implementación que aplique la exclusión solo en la raíz —o que mantenga dos listas distintas— obtendrá dos cadenas diferentes para el mismo registro y **no interoperará**, aunque su criptografía sea correcta.

Corolario que afecta a la lectura de paquetes firmados: como la exclusión es recursiva, la firma de un paquete **tampoco cubre** el `id`, `createdAt`, `status`, `origin`, `importedFrom` ni `confirmations` de los registros anidados. La firma de paquete acredita el **contenido** de los registros y su disposición en el array, no su ciclo de vida ni su procedencia (§9.3).

### 3.5 Pseudocódigo normativo

```text
función CANONICAL(valor):                       # sin parámetro de nivel: no hay niveles
  si valor es null o no es objeto:            # string, number, boolean, null
      devolver valor
  si valor es array:
      devolver [ CANONICAL(x) para cada x en valor ]     # orden preservado
  si valor es Uint8Array o Float32Array:
      devolver Array.from(valor)
  salida ← objeto vacío
  para cada clave k en ORDENAR(Object.keys(valor)):
      si k ∈ NOT_SIGNED:                      # los 20 nombres de §3.3
          continuar                           # en TODOS los niveles, sin excepción
      si valor[k] es undefined:
          continuar
      salida[k] ← CANONICAL(valor[k])
  devolver salida

firma_utf8 ← CODIFICAR_UTF8(SERIALIZAR_JSON(CANONICAL(objeto)))
```

La recursión es la única diferencia de forma respecto de una implementación de dos conjuntos: **no** hay ninguna comprobación de nivel (`top`) y **no** hay un segundo conjunto que solo se aplique a la raíz. Una implementación que necesite distinguir niveles para reproducir esta función está equivocada.

Nota de implementación: en el paso de serialización, un motor que reordene las claves con forma de índice entero debe reproducir R9, o rechazar tales claves.

---

## 4. Identidad (NEXUS ID)

### 4.1 Par de claves

| Parámetro | Valor exacto |
|---|---|
| Algoritmo | ECDSA sobre la curva **P-256** (secp256r1, prime256v1) |
| Parámetros WebCrypto | `{ name: 'ECDSA', namedCurve: 'P-256' }` |
| Algoritmo de firma | `{ name: 'ECDSA', hash: 'SHA-256' }` |
| Usos | `['sign', 'verify']` (par generado como **extraíble**, `extractable: true`) |
| Formato de exportación | **JWK** (RFC 7517) serializado como cadena JSON |
| Etiqueta declarada | `alg: "ECDSA-P256-SHA256"` |

**Almacenamiento.** El nodo guarda en la colección `identity`, con `id: "self"`, un registro con los campos: `id`, `pub` (cadena JWK pública), `priv` (cadena JWK privada), `fingerprint`, `name`, `langs` (array), `areas` (array), `createdAt`, `alg`, `version: 1` y, tras editar el perfil, `updatedAt`.

**Orden de campos del JWK.** La implementación de referencia produce, vía WebCrypto, esta secuencia exacta de propiedades:

```json
{"key_ops":["verify"],"ext":true,"kty":"EC","x":"…","y":"…","crv":"P-256"}
```

y, en la clave privada, `{"key_ops":["sign"],"ext":true,"kty":"EC","x":"…","y":"…","crv":"P-256","d":"…"}`. Verificado empíricamente en WebCrypto (motor V8 / Node 24).

> **Normativo (importante).** `pub` es una **cadena opaca**. Una implementación **DEBE** conservarla y retransmitirla **carácter por carácter**, y **DEBE** calcular la huella sobre esa cadena tal cual (§4.2). Un verificador que recomponga el JWK desde su propio analizador JSON y lo reserialice puede obtener otro orden de claves, y por tanto **otra huella**, aunque la verificación de firma siga siendo correcta (la firma depende del material de clave, no del texto). **La firma sobrevive al reordenamiento; la huella no.**

### 4.2 Huella `PAN-XXXX-XXXX-XXXX`

Algoritmo exacto, transcrito del código:

1. Sea `pub` la cadena JWK pública exacta (UTF-8).
2. `hex = SHA256_hex( UTF8(pub) )` → 64 caracteres hexadecimales en minúscula.
3. Se toman los **primeros 12 bytes**, en orden, desde el inicio: los bytes `i = 0…11` corresponden a los caracteres hexadecimales `hex[2i … 2i+2)`.
4. Cada byte `b` se mapea al carácter `ALFABETO[b mod 32]`, donde

   `ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"` — **32 caracteres**, sin `I`, sin `O`, sin `0`, sin `1`.
5. Los 12 caracteres se agrupan en tres grupos de 4 y se unen con guiones, con el prefijo `PAN-`:

   `PAN-` + `g0` + `-` + `g1` + `-` + `g2`, donde `g0 = c0c1c2c3`, `g1 = c4c5c6c7`, `g2 = c8c9c10c11`.

Índices del alfabeto (para verificación de una reimplementación):

| Índice | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Carácter | A | B | C | D | E | F | G | H | J | K | L | M | N | P | Q | R |

| Índice | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Carácter | S | T | U | V | W | X | Y | Z | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |

Vector verificado (Apéndice A):

| Paso | Valor |
|---|---|
| `pub` | `{"key_ops":["verify"],"ext":true,"kty":"EC","x":"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0","y":"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU","crv":"P-256"}` |
| SHA-256 hex | `2bca9d98ac7bedfcb2458d09c0f87cc896cd71049a1cb4b16e50b122cc61bbee` |
| 12 bytes (decimal) | 43, 202, 157, 152, 172, 123, 237, 252, 178, 69, 141, 9 |
| `b mod 32` | 11, 10, 29, 24, 12, 27, 13, 28, 18, 5, 13, 9 |
| Caracteres | M, L, 7, 2, N, 5, P, 6, U, F, P, K |
| **Huella** | **`PAN-ML72-N5P6-UFPK`** |

> El prefijo `PAN-` **no** participa en el cálculo: la huella se calcula solo sobre el JWK. La implementación de referencia contiene además dos huellas ficticias no derivadas de este algoritmo, usadas solo como datos de ejemplo: `PAN-SEED-0000-0000` (autor de los datos semilla, incluye caracteres fuera del alfabeto) y `local-anon` (autor anónimo, sin prefijo `PAN-`). Un verificador **DEBE** tratar esas cadenas como **no verificables** (§4.4) y **NO DEBE** intentar derivarlas.

### 4.3 El sobre de firma

```json
{
  "sig": "PuLVfIR1LNEepYutAEH2zP0UnBUivnMFnpN3Mh625sfNAYl4+tA92w1O85G9tFMprRgA8Wd+89Qy97VuZwVH0g==",
  "pub": "{\"key_ops\":[\"verify\"],\"ext\":true,\"kty\":\"EC\",\"x\":\"…\",\"y\":\"…\",\"crv\":\"P-256\"}",
  "fp": "PAN-ML72-N5P6-UFPK",
  "alg": "ECDSA-P256-SHA256",
  "at": 1735689700000
}
```

| Campo | Tipo | Obligatorio | Descripción y codificación exacta |
|---|---|---|---|
| `sig` | string | **Sí** | Firma **cruda** de ECDSA: la concatenación `r ‖ s` de **64 bytes** exactos (32 + 32, enteros de 256 bits en big-endian, rellenados por la izquierda con ceros), codificada en **Base64 estándar con relleno** (`btoa`, alfabeto `A–Z a–z 0–9 + /`, con `=`). **No** es ASN.1/DER. Una implementación que produzca DER **NO** interoperará. |
| `pub` | string | **Sí** | Cadena JWK pública, exactamente como se exportó. Se acepta también un objeto JWK (el código lo reserializa con `JSON.stringify`), pero **la forma canónica es la cadena** y una implementación **DEBERÍA** emitir siempre la cadena. |
| `fp` | string | No | Huella del firmante. **Redundante y no autoritativa:** el verificador **DEBE** recalcularla desde `pub` (§4.2) y **DEBE** rechazar el registro cuando no coincide con esta declaración (§4.4 paso 6, §4.5). Un verificador **NO DEBE** mostrar una huella que no haya derivado él mismo de la clave pública que validó. Su presencia es **opcional**: si falta, la verificación sigue siendo posible y la identidad del firmante se deriva igualmente de `pub`. |
| `alg` | string | No | Etiqueta informativa. Valor escrito por la referencia: `"ECDSA-P256-SHA256"`. Un verificador **DEBE** validar la firma por el algoritmo real (ECDSA P-256 + SHA-256), no por esta etiqueta. |
| `at` | number | No | Marca de tiempo de firma en milisegundos desde la época Unix (`Date.now()`). **No está protegida por la firma**: el sobre vive bajo la clave `sig`, que se excluye recursivamente (lista `NOT_SIGNED`, §3.3), de modo que ningún campo del sobre —`at` incluido— entra en la proyección canónica. `at` es una declaración informativa del firmante, no un hecho demostrado criptográficamente. |

**Base64:** la firma de 64 bytes produce siempre **88 caracteres** de Base64 terminados en `==`. Cualquier firma cuya longitud decodificada no sea 64 bytes **DEBE** considerarse inválida.

**Cómo se adjunta:** firmar devuelve el sobre; *sellar* un registro devuelve una **copia** con `{...registro, sig: sobre}`. Si no hay identidad local, la implementación de referencia **no firma** y devuelve el objeto sin `sig` (registro no verificable, no inválido).

### 4.4 Procedimiento de verificación (normativo)

Entrada: un objeto `rec` y, opcionalmente, un sobre explícito `env` (usado, por ejemplo, al verificar un manifiesto de MEMORIA reconstruido).

1. `env ← env` si se proporcionó; si no, `env ← rec.sig`. Si `env` no es un objeto, o falta `env.sig`, o falta `env.pub` → **FALLO: `sin_sobre`**.
2. Decodificar `env.sig` de Base64. Si la decodificación falla o su longitud ≠ 64 bytes → **FALLO: `firma_malformada`**.
3. Importar la clave pública: si `env.pub` es cadena, `JSON.parse(env.pub)`; si es objeto, usarlo. Importar como JWK ECDSA P-256 con uso `verify`. Si falla → **FALLO: `clave_publica_invalida`**.
4. Calcular `bytes ← UTF8(canonical(rec))` aplicando **las reglas de §3 al objeto `rec` completo** (el sobre `sig` se excluye automáticamente, porque `sig` está en `NOT_SIGNED`). Cuando el llamador pasa un `env` explícito, el objeto sobre el que se proyecta es el reconstruido que ese llamador indique (§9.4).
5. `crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, clave_pública, firma_bytes, bytes)`.
   - `true` → se pasa a la comprobación 6.
   - `false` → **FALLO: `firma_no_valida`** (el contenido no corresponde a la firma o la clave no es la del firmante).
6. **Comprobación de la huella declarada (segunda comprobación, obligatoria).** Si `env.fp` está presente:
   a. `fp_calc ← fingerprintOf(pub)` (§4.2, sobre la cadena `pub` **verbatim**, tal como llegó);
   b. si `fp_calc ≠ env.fp` → **FALLO: `huella_discrepante`**.
   Si `env.fp` **no** está presente, esta comprobación se omite, pero el verificador **DEBE** calcular igualmente `fp_calc` para informar de la identidad del firmante.
   > El orden importa: la comprobación de huella solo se alcanza si la firma ya validó. Un registro con firma inválida **y** huella falsa falla como `firma_no_valida`, no como `huella_discrepante`.
7. Cualquier excepción se captura y se traduce a `false`. La implementación de referencia **nunca** propaga el error: `verify` devuelve un booleano.

**Modos de fallo (taxonomía para implementaciones):**

| Código | Causa | ¿Qué prueba? | ¿Qué **no** prueba? |
|---|---|---|---|
| `sin_sobre` | El registro no tiene `sig`, o el sobre no tiene `sig`/`pub`. | Nada. El registro es **no verificable**. | No implica falsedad ni manipulación: la mayoría de los registros de ejemplo y los datos semilla nunca se firmaron. |
| `firma_malformada` | Base64 inválido o longitud ≠ 64 bytes (p. ej. firma en DER). | Que el emisor no usa este protocolo, o que el archivo se corrompió. | — |
| `clave_publica_invalida` | JWK mal formado, curva distinta de P-256, o clave privada enviada por error. | Que el sobre no es utilizable. | — |
| `firma_no_valida` | El contenido proyectado no coincide, o la clave no corresponde. | Que **al menos uno** de los campos firmados fue alterado, o que la clave no es la del autor. | No dice **cuál** campo cambió, ni si el cambio fue hostil. |
| `huella_discrepante` | `env.fp` existe y no es la huella de `env.pub` (§4.5). | Que la huella declarada fue **suplantada** o manipulada; que quien declaró ese `fp` no es el titular de la clave que firmó. | No dice nada sobre el contenido: la firma puede ser matemáticamente válida. |
| VÁLIDA | Todo lo anterior correcto. | Autoría del contenido proyectado por el titular de `pub`, y coherencia entre `fp` y `pub`. | Ver §15.1. |

> **Nota de implementación.** La función de referencia devuelve un único booleano, de modo que los códigos `firma_no_valida` y `huella_discrepante` no son distinguibles desde `Crypto.verify()`. Una implementación conforme **DEBERÍA** exponerlos por separado (§4.5, Apéndice D D22); la referencia permite distinguirlos llamando a `Crypto.signerOf()` y leyendo `spoofed`.

### 4.5 La huella declarada no es autoritativa: la suplantación de huella se rechaza en el verificador

La verificación consta de **dos** comprobaciones, y la segunda es tan importante como la primera:

1. que la firma sea matemáticamente válida para `sig.pub`;
2. que `sig.fp`, **cuando está presente**, sea exactamente `fingerprintOf(sig.pub)`.

Sin la segunda comprobación, cualquiera podría firmar con su propia clave y escribir en `fp` la huella de otra persona: la firma validaría y la interfaz mostraría un autor que no es el firmante. La huella es un dato **derivado** de la clave pública, así que se recalcula siempre y **nunca** se confía en la declarada. En la implementación de referencia `Crypto.verify` devuelve **falso** cuando `fp` no coincide con `pub`.

> **REQUISITO (normativo).**
> 1. Una implementación conforme **DEBE** calcular la identidad del firmante como `fingerprintOf(env.pub)` (§4.2, cadena `pub` **verbatim**) y **DEBE** tratar `env.fp` como un dato redundante y no autoritativo.
> 2. Si `env.fp` está presente y **no** coincide con la huella recalculada, la implementación **DEBE** tratar el registro como **no verificable** (código `huella_discrepante`, §4.4) y **DEBERÍA** informar de la discrepancia como posible suplantación.
> 3. Una implementación **NO DEBE** mostrar al usuario una huella que no haya derivado ella misma de la clave pública que acaba de validar. Mostrar `env.fp`, `origin.fingerprint` o cualquier huella declarada sin recalcular equivale a mostrar el nombre que el atacante eligió.
> 4. El cálculo de la huella desde `pub` es **obligatorio incluso cuando `env.fp` está ausente**: es la única forma de identificar al firmante.

`Crypto.signerOf(registro)` de la referencia devuelve exactamente eso, sin confiar en nada declarado:

| Campo devuelto | Significado |
|---|---|
| `fingerprint` | Huella **recalculada** desde `env.pub`. **Es** la identidad del firmante. |
| `claimed` | El valor declarado `env.fp`, o `null` si falta. |
| `spoofed` | `true` cuando `env.fp` existe y difiere de `fingerprint`. |
| `isSelf` | `true` cuando la huella recalculada coincide con la identidad local. |
| `at` | El `at` declarado del sobre (**no** autenticado; §15.1). |
| `verified` | El booleano de `Crypto.verify()`, que ya incluye la comprobación de huella. |

> **Nota de fidelidad.** `Crypto.verify()` devuelve un booleano y por sí solo **no distingue** `firma_no_valida` de `huella_discrepante`: para separar ambos diagnósticos hay que usar `signerOf()` y leer `spoofed`. Ver Apéndice D (D22).

---

## 5. Identidad portátil (`PANGEA-ID-1`)

### 5.1 Estructura

Archivo JSON (no cifrado en su envoltura; cifrado en su contenido).

| Campo | Tipo | Valor exacto escrito por la referencia |
|---|---|---|
| `format` | string | `"PANGEA-ID-1"` (literal, con mayúsculas y guion) |
| `kdf` | string | `"PBKDF2-SHA256-250000"` |
| `cipher` | string | `"AES-GCM-256"` |
| `salt` | string | Base64 (estándar, con relleno) de **16 bytes aleatorios** (`crypto.getRandomValues(new Uint8Array(16))`) |
| `iv` | string | Base64 de **12 bytes aleatorios** (`new Uint8Array(12)`), el tamaño de nonce recomendado para AES-GCM |
| `data` | string | Base64 del **texto cifrado con la etiqueta de autenticación GCM anexada al final** (WebCrypto `AES-GCM` devuelve `ciphertext ‖ tag` de 16 bytes) |
| `fingerprint` | string | Huella del titular, para mostrarla **antes** de pedir la contraseña |
| `createdAt` | string | Fecha ISO-8601 (`new Date().toISOString()`), p. ej. `"2026-09-10T12:34:56.789Z"` |

Ejemplo:

```json
{
  "format": "PANGEA-ID-1",
  "kdf": "PBKDF2-SHA256-250000",
  "cipher": "AES-GCM-256",
  "salt": "0Yb2n9p0mQ0m1kQm8m3Y3w==",
  "iv": "YWJjZGVmZ2hpamts",
  "data": "…base64 de (texto cifrado ‖ etiqueta de 16 bytes)…",
  "fingerprint": "PAN-ML72-N5P6-UFPK",
  "createdAt": "2026-09-10T12:34:56.789Z"
}
```

### 5.2 Contenido cifrado

El texto plano es el UTF-8 de:

```json
{
  "identity": {
    "id": "self",
    "pub": "…cadena JWK pública, verbatim…",
    "priv": "…cadena JWK privada (el secreto)…",
    "fingerprint": "PAN-ML72-N5P6-UFPK",
    "name": "Ana Ruiz",
    "langs": ["es"],
    "areas": ["agua"],
    "createdAt": 1735689600000,
    "alg": "ECDSA-P256-SHA256",
    "version": 1
  },
  "exportedAt": "2026-09-10T12:34:56.789Z"
}
```

Los valores concretos de la muestra son ilustrativos; lo normativo es el **conjunto de campos** y que `priv` viaja aquí en claro (protegido solo por el cifrado del sobre).

`identity` es el registro `self` **íntegro**: incluye la clave privada en claro (`priv`). Campos observables: `id: "self"`, `pub`, `priv`, `fingerprint`, `name`, `langs`, `areas`, `createdAt`, `alg`, `version`, `updatedAt` (si el perfil se editó). La implementación de referencia admite un parámetro `extra` que se fusiona en el sobre de nivel superior (`{identity, exportedAt, ...extra}`); la interfaz no lo usa, por lo que `extra` está vacío en la práctica.

> **Normativo.** Este sobre cifrado es **el único camino** por el que la clave privada sale del dispositivo. Ningún paquete de contenido —ni `pangea-exchange`, ni el pasaporte (§9.2), ni ningún otro— **DEBE** transportarla (§15.7). Un receptor **NO DEBE** aceptar una identidad que llegue por otro conducto: importar una identidad desde un paquete de datos permitiría sustituir la identidad de alguien con solo enviarle un archivo (§11.1).

### 5.3 Derivación y cifrado (normativo)

| Parámetro | Valor |
|---|---|
| KDF | PBKDF2 |
| Contraseña | UTF-8 de la contraseña introducida |
| Sal | los 16 bytes de `salt` |
| Iteraciones | **250 000** |
| Función resumen | SHA-256 |
| Derivación | `deriveKey` (no `deriveBits`), clave resultante no extraíble |
| Cifrado | AES-GCM, clave de **256 bits**, IV = los 12 bytes de `iv` |
| Etiqueta | 16 bytes (por defecto de WebCrypto AES-GCM), anexada al texto cifrado |

Requisito de longitud de contraseña (aplicado **solo al exportar**): 8 caracteres como mínimo; si es más corta, la exportación **DEBE** rechazarse. La importación no impone longitud mínima.

### 5.4 Procedimiento de descifrado

1. Comprobar `bundle.format === "PANGEA-ID-1"`. Si no coincide → error `Formato de identidad no reconocido`. **Una implementación conforme NO DEBE intentar descifrar un sobre cuyo `format` no reconoce.**
2. `salt ← base64_decode(bundle.salt)` (16 bytes), `iv ← base64_decode(bundle.iv)` (12 bytes), `ct ← base64_decode(bundle.data)`.
3. Derivar la clave: PBKDF2-SHA256, 250 000 iteraciones, 256 bits.
4. Descifrar AES-GCM con `iv`. Si el descifrado falla (comprobación de etiqueta GCM) → error `Contraseña incorrecta o archivo dañado`. **DEBE** tratarse como un único error: el protocolo no distingue contraseña errónea de archivo corrupto.
5. `JSON.parse(UTF8_decode(plano))` y tomar `.identity`.
6. Sobrescribir `id` con `"self"` (clave fija del almacén local) y persistir el registro en la colección `identity`.

**Comportamientos verificados que una reimplementación debe conocer:**

- La importación **ignora** `bundle.kdf` y `bundle.cipher`: los parámetros están codificados en duro. Un sobre con `kdf` distinto pero `format` correcto se descifraría con los parámetros equivocados y fallaría como «contraseña incorrecta».
- La importación **no** comprueba que `bundle.fingerprint` corresponda a la clave recuperada. Un verificador **DEBERÍA** recalcular la huella desde `pub` y compararla con `fingerprint` y con el `fp` del sobre, para detectar archivos manipulados.
- La importación **no** pide confirmación ni conserva la identidad anterior: sobrescribe. Una implementación **DEBERÍA** advertir explícitamente al usuario.

**Nombre de archivo y MIME.** `pangea-identity-{huella sin caracteres no alfanuméricos}.json`, MIME `application/json`. Ejemplo: para `PAN-ML72-N5P6-UFPK` el archivo es `pangea-identity-PANML72N5P6UFPK.json`.

---

## 6. Reputación portable (atestaciones)

### 6.1 Objeto `pangea.attestation`

```json
{
  "kind": "pangea.attestation",
  "from": "PAN-ML72-N5P6-UFPK",
  "to": "PAN-ABCD-EFGH-JKLM",
  "points": 10,
  "reason": "Alerta publicada",
  "context": {},
  "issuedAt": "2026-09-10T12:34:56.789Z",
  "nonce": "3f7kq2p1",
  "sig": { "sig": "…", "pub": "…", "fp": "PAN-ML72-N5P6-UFPK", "alg": "ECDSA-P256-SHA256", "at": 1757511296789 }
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `kind` | string | **Sí** | Literal `"pangea.attestation"`. Discriminador del objeto. |
| `from` | string | **Sí** | Huella del **emisor declarado** (quien otorga los puntos). |
| `to` | string | **Sí** | Huella del **receptor** (quien los recibe). Por omisión en la referencia: la propia huella del emisor (auto-atestación). |
| `points` | number | **Sí** | Puntos otorgados. Puede ser negativo (la interfaz representa `+10` / `−20`). Valores usados por la referencia: `+10` alerta, `+6` respuesta, `+5` saber, `+3` curaduría, `+3` afirmación, `+2` confirmación, `+1` voto, `+10` emparejamiento resuelto. |
| `reason` | string | **Sí** | Texto libre. En la referencia es una cadena **ya traducida** al idioma del nodo emisor, por lo que **no** es comparable entre idiomas. |
| `context` | object | No | Objeto libre; la referencia lo emite vacío (`{}`). |
| `issuedAt` | string | **Sí** | Fecha ISO-8601 del momento de emisión. |
| `nonce` | string | **Sí** | Aleatorio de un solo uso: un entero sin signo de 32 bits generado con `crypto.getRandomValues(new Uint32Array(1))[0]` y expresado en **base 36** (p. ej. `"3f7kq2p1"`). Longitud típica 1–7 caracteres. |
| `sig` | object | Condicional | Sobre de firma (§4.3). Ausente si no había identidad al emitir. La referencia lo emite con `fp`; si `fp` no coincide con la huella recalculada de `sig.pub`, la atestación **DEBE** considerarse no verificable (§4.5, §6.3). |

### 6.2 Para qué sirve el `nonce`

El `nonce` **no** es un contador de replay ni un identificador de registro: es un valor impredecible que impide que dos atestaciones con el mismo `from`, `to`, `points`, `reason`, `context` e `issuedAt` (mismo milisegundo) tengan la misma proyección canónica. Su función normativa es **hacer única cada atestación** para que un agregador pueda deduplicar y contabilizar sin confundir dos otorgamientos idénticos, y para que el emisor no pueda negar que emitió dos veces el mismo reconocimiento. Un verificador **NO DEBE** rechazar una atestación por repetición de `nonce`: el `nonce` es aleatorio, no monótono.

### 6.3 Verificación de una atestación ajena (normativo)

Entrada: el objeto `att` completo, tal como viajó.

1. Comprobar que `att.kind === "pangea.attestation"`. Si no → **no es una atestación**.
2. Comprobar que `att.sig` existe y tiene `sig` y `pub`. Si no → **no verificable** (no «falsa»).
3. Verificar la firma con §4.4 sobre el objeto `att` completo (la clave `sig` se excluye sola). Resultado `ok`. **Incluye la comprobación de huella**: si `att.sig.fp` existe y no es la huella de `att.sig.pub`, el paso devuelve `ok = false` (§4.5).
4. Recalcular la huella del firmante: `fp_calc ← fingerprintOf(att.sig.pub)` (§4.2, cadena verbatim). Este valor se devuelve como `signerFingerprint` y **es** la identidad del firmante.
5. **Comprobación del emisor declarado:** `matchesIssuer ← (fp_calc === att.from)`. Si no coincide → la atestación **no acredita al emisor declarado**: la firmó alguien distinto.
6. Veredicto, con **tres** valores posibles:

| `verdict` | Condición | Qué significa |
|---|---|---|
| `"válida"` | firma verificada **y** `matchesIssuer` | El titular de `att.sig.pub` firmó esto y **es** el emisor declarado en `from`. |
| `"firma válida, emisor no coincide"` | firma verificada pero `fp_calc ≠ att.from` | La firma es matemáticamente correcta, pero el emisor declarado **no** es quien firmó. Señal de suplantación: **NO DEBE** contabilizarse como reputación del emisor declarado. |
| `"no verificable"` | La firma no verifica (incluida `huella_discrepante`) | No se puede atribuir la atestación a nadie. |

La función de referencia devuelve `{ valid, from, to, points, reason, issuedAt, signerFingerprint, declaredIssuer, matchesIssuer, verdict }`, donde `signerFingerprint` y `declaredIssuer` son `null` si no hay clave pública utilizable en el sobre, y `matchesIssuer` se calcula como `signerFingerprint === att.from`.

> **Normativo.** Un agregador **NO DEBE** sumar los puntos de una atestación cuyo veredicto sea `"firma válida, emisor no coincide"` al emisor declarado: los puntos pertenecen al firmante real, no a la huella escrita en `from`. El veredicto `"no verificable"` **NO DEBE** presentarse como «falsa» (la atestación puede ser simplemente ilegible o estar dañada).

### 6.4 Propiedad anti-falsificación y sus límites

**Lo que la atestación prueba** (si el veredicto es `"válida"`, es decir, si se cumplen los pasos 3 y 5 de §6.3):

- Que el titular de la clave pública contenida en `att.sig.pub` firmó **exactamente** este contenido: estos `to`, estos `points`, este `reason`, este `context`, este `issuedAt`, este `nonce`.
- Que `att.from` **es** la huella de ese titular (porque la huella se deriva de esa clave).
- Que el contenido no fue modificado después de firmar: cambiar un solo punto, o el destinatario, o una letra del motivo, invalida la firma.

**Lo que la atestación NO prueba:**

| Límite | Explicación |
|---|---|
| Veracidad del motivo | La firma acredita que el emisor **dijo** eso, no que sea cierto. |
| Buena fe | Un emisor puede firmar diez mil atestaciones por un favor inexistente. Son válidas y no valen nada. |
| Identidad civil | Prueba el control de una clave, no que esa clave sea de una persona concreta. |
| Unicidad del emisor | Nada impide que una persona genere cien pares de claves y se otorgue puntos a sí misma desde cien huellas distintas. Es el ataque de Sybil, y el protocolo **no** lo resuelve: solo lo hace auditable. |
| Ausencia de replay | El objeto es un dato estático: puede reenviarse infinitas veces. Copiar una atestación válida es siempre posible; la firma no caduca ni está ligada a un contexto de uso. La defensa es de **agregación**: quien suma reputación **DEBE** deduplicar por el par (`from`, `nonce`) y **DEBERÍA** limitar los puntos aceptados de una sola huella emisora hacia una misma huella receptora. |
| No repudio legal | Depende de la jurisdicción y de la custodia de la clave, no del formato. |

### 6.5 Dónde vive la reputación (y por qué no es autoritativa)

En la implementación de referencia, cada otorgamiento produce **dos** cosas:

1. Una **atestación firmada** (el objeto de §6.1).
2. Un **registro de evento** en la colección `events`, creado sin firma propia: `{ id, type: "points", message: <reason>, meta: { points, attestation } , createdAt, updatedAt }`. El total de puntos local se obtiene sumando `meta.points` de todos los eventos con `type === "points"`.

> **Normativo.** Un nodo **NO DEBE** tratar la colección `events` como fuente autoritativa de reputación: los eventos no están firmados y cualquier nodo puede escribir los que quiera en su propio almacén. La reputación **portable** son las atestaciones firmadas. Un nodo que muestra una reputación agregada **DEBERÍA** informar de cuántos puntos provienen de atestaciones verificadas y con qué emisores, y **DEBERÍA** listar los emisores distintos.

---

## 7. Colecciones y esquemas

### 7.0 Reglas generales

| Regla | Detalle |
|---|---|
| Nombres de colección | Fijos y en minúsculas, tal como en §7.1–§7.12. **NO DEBEN** renombrarse ni traducirse. |
| `id` | Cadena. Clave primaria. La referencia genera `uid(prefijo)` = `"{prefijo}_{Date.now().toString(36)}{aleatorio1.toString(36)}{aleatorio2.toString(36)}"` truncado a 40 caracteres, con prefijo = primeros 4 caracteres del nombre de la colección. Dos colecciones usan **id determinista compuesto**: `votes` = `"{claimId}::{huella}"` (un voto por identidad y afirmación) y `curations` = `"{knowledgeId}::{huella}"` (una curaduría por identidad y saber). |
| `createdAt` | Número, milisegundos desde la época. `Store.put` lo asigna si falta. **Excluido** de la firma en la raíz. |
| `updatedAt` | Número, ms. **Reescrito por el almacén en cada escritura.** Excluido **siempre** de la firma. |
| `author` | Objeto `{ fingerprint: string, name: string, anon: boolean }`. Lo añade la capa de publicación. Si no hay identidad: `{ fingerprint: "local-anon", name: "—", anon: true }` y **el registro no se firma**. Nombre por omisión: `id.name` o los caracteres 4–12 de la huella. |
| `lang` | Código de idioma de dos letras del nodo que publica. Valores de la interfaz: `es, en, pt, fr, ar, hi, zh, ru`. |
| `sig` | Sobre de firma (§4.3), o ausente. |
| Firma parcial | **Idéntico contenido firmado ≠ registro completo.** El contenido firmado de un registro es su proyección canónica según §3 con la exclusión de §3.3, que es **una sola lista aplicada en todos los niveles**. Los campos marcados «no firmado» a continuación **PUEDEN** ser modificados por cualquier nodo —el autor o cualquier otro— sin romper la firma, tanto si el registro viaja suelto como si viaja anidado dentro de un paquete. |
| Orden de las claves en el texto JSON | **No es normativo.** Los ejemplos de este documento muestran, cuando resulta útil, el orden real que produce la implementación de referencia (el almacén coloca `createdAt` primero y `updatedAt` al final), pero lo único normativo es la proyección canónica de §3. Un lector **NO DEBE** depender del orden del archivo. |

### 7.1 `problems` — problemas publicados (SYNAPSE)

Publicado con: `{ kind: 'problem', status: 'abierto', ...datos }`.

| Campo | Tipo | Obligatorio | ¿En el contenido firmado? | Descripción |
|---|---|---|---|---|
| `id` | string | Sí (lo asigna el almacén si falta) | **No** (exclusión recursiva) | Clave primaria. |
| `createdAt` | number | Sí | **No** (exclusión recursiva) | ms época. |
| `updatedAt` | number | Sí (lo asigna el almacén) | **No** (exclusión recursiva) | ms época. |
| `kind` | string | Sí | **Sí** | Literal `"problem"`. |
| `status` | string | Sí | **No** (exclusión recursiva) | `"abierto"` es el único valor escrito por la referencia. La interfaz trata **la ausencia** de `status` como `abierto` (`p.status \|\| 'abierto'`). |
| `title` | string | Sí | **Sí** | Mínimo 5 caracteres al publicar; sin máximo en el modelo. |
| `body` | string | Sí | **Sí** | Mínimo 20 caracteres al publicar. |
| `category` | string | Sí | **Sí** | Id de la taxonomía compartida (§8). |
| `urgency` | string | No | **Sí** | Uno de `low`, `medium`, `high`, `critical`. Si falta, la puntuación de emparejamiento aporta 0. |
| `location` | object\|null | No | **Sí** | `{ label: string\|null, lat: number\|null, lng: number\|null }`. Admite solo etiqueta sin coordenadas. |
| `tags` | array\<string\> | No | **Sí** | Máximo 8 elementos al publicar; el orden se conserva y **es significativo** para la firma. |
| `author` | object | Sí | **Sí** | §7.0. |
| `lang` | string | Sí | **Sí** | §7.0. |
| `sig` | object | Condicional | **No** (exclusión recursiva) | Sobre de firma. |

### 7.2 `capacities` — capacidades y recursos ofrecidos (SYNAPSE)

Publicado con: `{ kind: 'capacity', status: undefined, ...datos }`.

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id`, `createdAt`, `updatedAt` | — | Sí | **No** | Igual que §7.1. |
| `kind` | string | Sí | **Sí** | Literal `"capacity"`. |
| `status` | string\|undefined | No | **No** | La referencia envía `status: undefined`, que la proyección y el JSON **omiten**. Las capacidades no tienen ciclo de vida. |
| `title` | string | Sí | **Sí** | Mínimo 5 caracteres. |
| `body` | string | Sí | **Sí** | Mínimo 20 caracteres. |
| `category` | string | Sí | **Sí** | Id de la taxonomía (§8). |
| `urgency` | — | — | — | No aplica: el formulario la omite para capacidades. |
| `location` | object\|null | No | **Sí** | Igual que §7.1. |
| `tags` | array\<string\> | No | **Sí** | Máximo 8. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí**; `sig` no | §7.0. |

### 7.3 `matches` — emparejamientos y su estado Kanban (SYNAPSE / AGENTE)

Dos productores con la misma forma base.

Creado por SYNAPSE:

```json
{
  "id": "mat_m3k9x2p0q1",
  "createdAt": 1735689600000,
  "needId": "prob_1a2b3c4d5e",
  "offerId": "capa_9f8e7d6c5b",
  "score": 72,
  "explain": {
    "parts": [
      { "key": "synapse.semanticClose", "detail": "81%", "points": 36 },
      { "key": "synapse.sameCategory", "detail": "Agua", "points": 20 },
      { "key": "synapse.sharedTerms", "detail": "filtro, agua", "points": 8 },
      { "key": "synapse.locationClose", "detail": "12 km", "points": 8 }
    ],
    "semantic": 81,
    "shared": ["filtro", "agua"],
    "needTitle": "El agua de la red llega contaminada…",
    "offerTitle": "Taller de filtros cerámicos",
    "needCat": "agua",
    "offerCat": "agua"
  },
  "status": "sugerido",
  "collaborators": [],
  "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false },
  "lang": "es"
}
```

Creado por AGENTE (nótese `explain` distinto):

```json
{
  "id": "mat_p7q6r5s4t3",
  "needId": "prob_1a2b3c4d5e",
  "offerId": null,
  "score": 61,
  "explain": {
    "source": "agente",
    "rules": [ { "label": "Categoría · intereses", "points": 34 }, { "label": "Afinidad semántica", "points": 15.4 } ],
    "affinity": 0.701
  },
  "status": "sugerido"
}
```

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id`, `createdAt`, `updatedAt` | — | Sí | **No** | §7.1. |
| `needId` | string\|null | Condicional | **Sí** | `id` del problema. `null` cuando el agente propone sobre una capacidad. |
| `offerId` | string\|null | Condicional | **Sí** | `id` de la capacidad. `null` cuando el agente propone sobre un problema. |
| `score` | number | Sí | **No** (exclusión recursiva) | Puntuación 0–100. **Recomendado**: no firmar la puntuación, porque cada nodo puede recalcularla con otro motor. Coincide con la exclusión de la referencia. |
| `explain` | object | Sí | **No** (exclusión recursiva) | Razonamiento. `parts[]` con `{key, detail, points}`; `semantic` (0–100); `shared[]` (máx. 6 términos); `needTitle`, `offerTitle`, `needCat`, `offerCat`. El productor AGENTE usa `{source:"agente", rules:[{label, points}], affinity}`. |
| `status` | string | Sí | **No** | Ver la tabla de estado Kanban más abajo. |
| `collaborators` | array\<object\> | No | **No** | Array de `{fingerprint, name}` que **crece** cuando alguien mueve el emparejamiento a `en_colaboracion`. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** cuando lo crea SYNAPSE; los emparejamientos del agente se escriben **sin firma** | §7.0. |

**Estado del emparejamiento (Kanban) — valores exactos y significado:**

| Valor | Columna | Etiqueta (es) | Significado operativo |
|---|---|---|---|
| `sugerido` | `synapse.colSuggested` | «Matches sugeridos» | El motor propuso el par; nadie ha actuado. Valor por omisión cuando falta `status`. |
| `en_colaboracion` | `synapse.colWorking` | «En colaboración» | Alguien pulsó «proponer colaboración»; su identidad se añadió a `collaborators`. |
| `resuelto` | `synapse.colResolved` | «Resueltos» | El problema se considera atendido. Otorga +10 puntos. |

La columna «Problemas abiertos» del tablero **no** es un estado de `matches`: lista los `problems` con `status` ausente o `abierto`. Umbrales del motor (política, no protocolo): se crea un emparejamiento cuando `score >= 45`.

### 7.4 `claims` — afirmaciones a verificar (VERITAS)

Publicado con: `{ text, category, sources, status: 'abierta' }`.

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id`, `createdAt`, `updatedAt` | — | Sí | **No** | §7.1. |
| `text` | string | Sí | **Sí** | Enunciado. Mínimo 12 caracteres al publicar. |
| `category` | string | Sí | **Sí** | Id de la taxonomía (§8). Si no hay taxonomía, primera categoría por omisión. |
| `sources` | array\<object\> | No | **Sí** | `[{ title: string, url: string }]`. Se descartan las entradas sin `title` ni `url`. El orden se conserva. |
| `status` | string | Sí (asignado) | **No** (exclusión recursiva) | **No se persiste tal cual**: es un valor derivado que se calcula en memoria. Ver abajo. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** | §7.0. |

**Estado de la afirmación — derivado, no almacenado:**

| Valor | Condición exacta |
|---|---|
| `abierta` | `total_votos < 5` (muestra insuficiente) |
| `consenso` | `total_votos >= 5` **y** `round(\|acuerdo\| · 100) >= 66` |
| `disputada` | `total_votos >= 5` **y** `round(\|acuerdo\| · 100) < 66` |

donde `acuerdo = suma_ponderada / denominador`, `suma_ponderada = Σ peso(valor)`, `denominador = nº de votos con valor distinto de "unverifiable"`, y los pesos son los de §7.5.

> **Normativo (interoperabilidad crítica).** `status` **NO DEBE** ser tratado como dato firmado de la afirmación: en la referencia el valor `'abierta'` **sí** se envía a la capa de publicación y queda en el registro, pero **se excluye de la firma** (está en `NOT_SIGNED`, §3.3) y todos los demás valores (`consenso`, `disputada`) nunca se escriben. Un nodo que recalcule el estado a partir de los votos **NO DEBE** considerarse en conflicto con el valor almacenado. Dos nodos con los mismos votos y el mismo motor de consenso llegan al mismo estado.

### 7.5 `votes` — votos y fuentes (VERITAS)

Id determinista: `"{claimId}::{huella}"`. Revotar **reemplaza** el registro (misma clave primaria).

```json
{
  "id": "clai_7g8h9j0k::PAN-ML72-N5P6-UFPK",
  "createdAt": 1735689600000,
  "claimId": "clai_7g8h9j0k",
  "voter": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz" },
  "value": "true",
  "evidence": "El informe del acueducto municipal de marzo confirma…",
  "sources": [ { "title": "Informe ACM", "url": "https://ejemplo.org/informe.pdf" } ],
  "at": 1735689600000,
  "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false },
  "lang": "es"
}
```

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id` | string | Sí | **No** | `"{claimId}::{huella}"`. |
| `createdAt`, `updatedAt` | number | Sí | **No** | §7.1. |
| `claimId` | string | Sí | **Sí** | `id` de la afirmación votada. |
| `voter` | object | Sí | **Sí** | `{ fingerprint: string, name: string }`. |
| `value` | string | Sí | **Sí** | Uno de `true`, `false`, `context`, `unverifiable`. |
| `evidence` | string | Sí | **Sí** | Mínimo 12 caracteres al publicar. |
| `sources` | array\<object\> | No | **Sí** | Igual que §7.4. |
| `at` | number | Sí | **Sí** | ms época del voto. **Sí está firmado** (a diferencia de `createdAt`), y es la marca que usa el detector de anomalías: `ts = at \|\| createdAt`. Conservarlo es esencial para auditar ráfagas. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** | §7.0. |

**Valores de voto y pesos (política de agregación de la referencia):**

| Valor | Etiqueta (es) | Peso | ¿Cuenta en el denominador? |
|---|---|---|---|
| `true` | «Verdadero» | **+1** | Sí |
| `false` | «Falso» | **−1** | Sí |
| `context` | «Falta contexto» | **+0.35** | Sí |
| `unverifiable` | «No verificable» | **0** | **No** |

Un valor desconocido se normaliza a `unverifiable` al agregar.

### 7.6 `knowledge` — saberes preservados (MEMORIA)

Publicado con `{ title, kind, content, culture, contentLang, license, tags, attachments }`.

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id`, `createdAt`, `updatedAt` | — | Sí | **No** | §7.1. |
| `title` | string | Sí | **Sí** | Título. |
| `kind` | string | Sí | **Sí** | Uno de `text`, `audio`, `image`, `document`, `recipe`. |
| `content` | string | Condicional | **Sí** | Texto. Obligatorio **solo si** no hay adjuntos. |
| `culture` | string | No | **Sí** | Cultura o comunidad de origen. Máx. 120 caracteres en la interfaz. |
| `contentLang` | string | Sí | **Sí** | Idioma del contenido. Valores: `es, en, pt, fr, ar, hi, zh, ru`. |
| `license` | string | Sí | **Sí** | Uno de `cc-by`, `cc-by-sa`, `cc0`, `all-rights`. |
| `tags` | array\<string\> | No | **Sí** | Etiquetas; orden significativo. |
| `attachments` | array\<object\> | No | **Sí** | `[{ name, type, size, dataUrl, text? }]`. `dataUrl` es una URL de datos Base64 (embebe el archivo). `text` **se omite** si está vacío (`undefined`). Límite de la referencia: 8 MiB por adjunto (8 388 608 bytes); en modo ligero no se incrustan imágenes por encima de 900 KiB. |
| `seed` | boolean | No | **No** (exclusión recursiva) | `true` en los registros cargados de `data/conocimiento-semilla.json`. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** | §7.0. `lang` es el idioma del nodo; `contentLang` es el del saber. |

**Tipos de saber (`kind`) y sus etiquetas:**

| `kind` | Etiqueta (es) |
|---|---|
| `text` | Texto |
| `audio` | Audio |
| `image` | Imagen |
| `document` | Documento |
| `recipe` | Receta o procedimiento |

**Licencias (`license`) y sus etiquetas:**

| `license` | Etiqueta (es) |
|---|---|
| `cc-by` | Creative Commons BY |
| `cc-by-sa` | Creative Commons BY-SA |
| `cc0` | Dominio público (CC0) |
| `all-rights` | Todos los derechos reservados |

Un valor de licencia desconocido se muestra como «Todos los derechos reservados»; un `kind` desconocido se muestra como «Texto». Ninguno invalida el registro.

### 7.7 `curations` — validaciones de curadores (MEMORIA)

Id determinista: `"{knowledgeId}::{huella}"`. Una curaduría por identidad y saber.

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id` | string | Sí | **No** | `"{knowledgeId}::{huella}"`. |
| `createdAt`, `updatedAt` | number | Sí | **No** | §7.1. |
| `knowledgeId` | string | Sí | **Sí** | `id` del saber curado. |
| `curator` | object | Sí | **Sí** | `{ fingerprint: string, name: string }`. |
| `score` | number | Sí | **Sí** | Nota entera, acotada a **1–5** (`clamp(Number(score) \|\| 0, 1, 5)`). |
| `note` | string | No | **Sí** | Comentario libre. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** | §7.0. |

### 7.8 `alerts` — alertas de emergencia (SOS)

Publicado con: `{ id, createdAt, type, severity, title, body, location, status, confirmations, origin, importedFrom }`.

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id` | string | Sí | **No** | Prefijo de la referencia: `alert_…`. |
| `createdAt` | number | Sí | **No** | §7.1. |
| `updatedAt` | number | Sí | **No** | §7.1. |
| `type` | string | Sí | **Sí** | Uno de `natural`, `medical`, `humanitarian`, `infra`, `other`. Valor por omisión en la interfaz: `natural`. |
| `severity` | string | Sí | **Sí** | Uno de `low`, `medium`, `high`, `critical`. Valor por omisión: `medium`. |
| `title` | string | Sí | **Sí** | Máx. 140 caracteres en la interfaz (la importación trunca a **160**). Si queda vacío, se usa el `id`. |
| `body` | string | No | **Sí** | Máx. 2000 caracteres (interfaz y truncado de importación). |
| `location` | object\|null | No | **Sí** | `{ lat: number, lng: number, label: string }`. La interfaz fija 5 decimales y acota `lat` a ±90, `lng` a ±180. `label` máx. 120 caracteres; por omisión `"{lat}, {lng}"`. |
| `status` | string | Sí | **No** (exclusión recursiva) | `"activa"` o `"atendida"`. Cualquier otro valor se normaliza a `activa` al importar. |
| `confirmations` | array\<string\> | Sí | **No** (exclusión recursiva) | Huellas de quienes confirman. Sin duplicados. La importación filtra a cadenas y recorta a 500. |
| `origin` | string | Sí | **No** (exclusión recursiva) | `"local"` o `"imported"`. Lo **reescribe el receptor**. |
| `importedFrom` | string\|null | Sí | **No** (exclusión recursiva) | Huella del nodo de origen. `null` si es local. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** | §7.0. |

**Tipos de alerta y sus etiquetas:**

| `type` | Etiqueta (es) |
|---|---|
| `natural` | Desastre natural |
| `medical` | Médica |
| `humanitarian` | Humanitaria |
| `infra` | Infraestructura |
| `other` | Otra |

**Severidades y su orden de prioridad (`SEV_RANK`):**

| `severity` | Etiqueta (es) | Rango | Color |
|---|---|---|---|
| `critical` | Crítica | 0 (primero) | `#EF4444` |
| `high` | Alta | 1 | `#F59E0B` |
| `medium` | Media | 2 | `#06B6D4` |
| `low` | Baja | 3 | `#10B981` |

Una severidad desconocida recibe rango 9 (al final) y color `medium`. El orden de la lista visible es: severidad ascendente por rango y, a igual rango, `createdAt` descendente.

### 7.9 `responses` — respuestas con recursos (SOS)

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id` | string | Sí | **No** | Prefijo de la referencia: `resp_…`. |
| `createdAt`, `updatedAt` | number | Sí | **No** | §7.1. |
| `alertId` | string | Sí | **Sí** | `id` de la alerta respondida. |
| `responder` | object | Sí | **Sí** | `{ fingerprint, name, anon }`. |
| `resources` | array\<string\> | Sí | **Sí** | Al menos un valor al publicar. Ver tabla. |
| `message` | string | No | **Sí** | Máx. 600 caracteres en la interfaz. |
| `distanceKm` | number\|null | No | **Sí** | Distancia calculada por el respondiente; `null` si no hay coordenadas. |
| `author`, `lang`, `sig` | — | — | `author`/`lang` **sí** | §7.0. |

**Recursos (`resources`) y sus etiquetas:**

| Valor | Etiqueta (es) |
|---|---|
| `transport` | Transporte |
| `shelter` | Refugio |
| `water` | Agua |
| `medicine` | Medicinas |
| `food` | Alimentos |
| `skills` | Conocimientos médicos o técnicos |
| `comms` | Comunicaciones |
| `power` | Energía eléctrica |
| `other` | Otro recurso |

Al mostrar, se descartan los valores fuera de esta lista.

### 7.10 `vocab` — diccionario vivo de lenguas (LINGUA)

Publicado con `{ word, meaning, dialect, speaker, lang, audio }`.

| Campo | Tipo | Obligatorio | ¿Firmado? | Descripción |
|---|---|---|---|---|
| `id` | string | Sí | **No** | Prefijo de la referencia: `voc_…`. |
| `createdAt`, `updatedAt` | number | Sí | **No** | §7.1. |
| `word` | string | Sí | **Sí** | Mínimo 2 caracteres. Máx. 80 en la interfaz. |
| `meaning` | string | Sí | **Sí** | Mínimo 2 caracteres. Máx. 160 en la interfaz. |
| `dialect` | string | No | **Sí** | Texto libre. |
| `speaker` | string | No | **Sí** | Texto libre (hablante o informante). |
| `lang` | string | Sí | **Sí** | Código del selector de LINGUA (12 idiomas): `es, en, pt, fr, it, de, ar, hi, zh, ja, ru, sw`. |
| `audio` | string\|null | No | **Sí** | URL de datos (`data:audio/webm;base64,…`). **Se firma**: puede ser grande y no debe regenerarse. |
| `author`, `sig` | — | — | `author` **sí** | §7.0. Nota: al publicar una palabra, el `lang` del registro es el del nodo, y el idioma de la palabra es el campo `lang` explícito del formulario. |

### 7.11 `agents` — perfil del representante personal (AGENTE)

Colección con **un único registro**, `id: "self"`. **No está firmado** en la implementación de referencia.

```json
{
  "id": "self",
  "name": "Mi agente",
  "areas": ["agua", "salud"],
  "langs": ["es", "en"],
  "availability": "available",
  "autonomy": "mid",
  "notify": true,
  "autoMatch": false,
  "active": true,
  "llm": { "endpoint": "", "key": "", "model": "gpt-4o-mini" },
  "log": [ { "…": "…" } ],
  "createdAt": 1735689600000,
  "updatedAt": 1735689600000
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | Sí | Siempre `"self"`. |
| `name` | string | No | Nombre del agente (por omisión, cadena vacía). |
| `areas` | array\<string\> | No | Ids de la taxonomía (§8) que interesan al usuario. |
| `langs` | array\<string\> | No | Códigos de idioma. Si queda vacío, el nodo lo rellena con su propio idioma. |
| `availability` | string | Sí | Uno de `available` («Disponible para colaborar»), `busy` («Ocupado, solo urgencias»), `unavailable` («No disponible»). Valor por omisión: `available`. |
| `autonomy` | string | Sí | Uno de `low` («Solo avisar»), `mid` («Sugerir y preparar»), `high` («Actuar y notificar»). Valor por omisión: `mid`. |
| `notify` | boolean | Sí | Por omisión `true`. |
| `autoMatch` | boolean | Sí | Por omisión `false`. |
| `active` | boolean | Sí | Por omisión `true`. |
| `llm` | object | Sí | `{ endpoint, key, model }`. `model` por omisión `"gpt-4o-mini"`. **`key` contiene un secreto en claro** (§15.7). |
| `log` | array\<object\> | No | Máximo 50 entradas. La referencia guarda decisiones locales. |
| `createdAt`, `updatedAt` | number | Sí | ms época. |

Umbrales del agente (política, no protocolo): propone si `score >= 55`, actúa solo si `score >= 75` con `autonomy: "high"`, máximo 3 emparejamientos automáticos por sesión.

### 7.12 `events` — registro de actividad

Creado por la capa de registro (`Store.log(type, message, meta)`) y por el otorgamiento de puntos. **Sin firma.**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | Sí | Generado por el almacén (prefijo `even`). |
| `type` | string | Sí | Tipo de evento. Valores usados por la referencia: `points`, `reputacion`, `lingua`, `synapse`, `nexus`. |
| `message` | string | Sí | Texto legible, ya traducido en el nodo emisor. |
| `meta` | object | Sí | Datos estructurados. Para `type: "points"`: `{ points: number, attestation: <objeto §6.1> }`. |
| `createdAt`, `updatedAt` | number | Sí | ms época. |

### 7.13 Colecciones fuera del contenido de intercambio

| Colección | Contenido | Nota normativa |
|---|---|---|
| `settings` | Pares clave-valor: `{ id, value, createdAt }` con clave = nombre de preferencia. Claves conocidas: `pref.theme`, `pref.lang`, `pref.lite`, `pref.node`, `pref.llm.endpoint`, `pref.llm.key`, `pref.translate.endpoint`, `pref.translate.endpoint.token`, `seeds.version`. | **PUEDE** transportarse, pero **DEBE** filtrarse antes de exportar: contiene secretos y direcciones de red privadas. La implementación de referencia ya excluye `Store.SENSITIVE_SETTINGS` = `pref.llm.key`, `pref.translate.endpoint.token` (§9.1, §15.7). |
| `identity` | Registro único `id: "self"` con `pub` **y `priv`**. | **NO DEBE** incluirse jamás en un paquete de contenido: contiene la clave privada en claro. La exportación de la referencia ya lo excluye **por omisión** (`Store.exportAll({ includeIdentity: false })`, §9.1) y la importación genérica lo **ignora siempre** (§11.1). Solo viaja por el sobre cifrado `PANGEA-ID-1` (§5). |
| `telemetry` | Contadores diarios locales `{ id: "YYYY-MM-DD", counters: {…}, createdAt, updatedAt }`. | **NO DEBE** transportarse. Es telemetría local del nodo. |

### 7.14 Enumeraciones consolidadas

| Enumeración | Colección | Valores exactos |
|---|---|---|
| Estado del problema | `problems` | `abierto` |
| Estado del emparejamiento | `matches` | `sugerido`, `en_colaboracion`, `resuelto` |
| Estado de la afirmación | `claims` | `abierta`, `consenso`, `disputada` (derivado) |
| Urgencia | `problems` | `low`, `medium`, `high`, `critical` |
| Valor del voto | `votes` | `true`, `false`, `context`, `unverifiable` |
| Tipo de alerta | `alerts` | `natural`, `medical`, `humanitarian`, `infra`, `other` |
| Severidad | `alerts` | `low`, `medium`, `high`, `critical` |
| Recurso de respuesta | `responses` | `transport`, `shelter`, `water`, `medicine`, `food`, `skills`, `comms`, `power`, `other` |
| Tipo de saber | `knowledge` | `text`, `audio`, `image`, `document`, `recipe` |
| Licencia | `knowledge` | `cc-by`, `cc-by-sa`, `cc0`, `all-rights` |
| Estado de la alerta | `alerts` | `activa`, `atendida` |
| Procedencia | `alerts` | `local`, `imported` |
| Disponibilidad del agente | `agents` | `available`, `busy`, `unavailable` |
| Autonomía del agente | `agents` | `low`, `mid`, `high` |
| Idioma (interfaz) | `author.lang` | `es`, `en`, `pt`, `fr`, `ar`, `hi`, `zh`, `ru` |
| Idioma (LINGUA) | `vocab.lang`, `contentLang` (8) | `es`, `en`, `pt`, `fr`, `it`, `de`, `ar`, `hi`, `zh`, `ja`, `ru`, `sw` |

---

## 8. Taxonomía compartida

Los 14 identificadores de la taxonomía, transcritos de `data/categorias.json` (versión 1):

| # | `id` | Icono | Color |
|---|---|---|---|
| 1 | `salud` | `heart` | `#EF4444` |
| 2 | `alimentacion` | `seedling` | `#10B981` |
| 3 | `agua` | `layers` | `#06B6D4` |
| 4 | `energia` | `bolt` | `#F59E0B` |
| 5 | `educacion` | `book` | `#6366F1` |
| 6 | `vivienda` | `home` | `#8B5CF6` |
| 7 | `medioambiente` | `globe` | `#22C55E` |
| 8 | `tecnologia` | `bot` | `#3B82F6` |
| 9 | `transporte` | `map` | `#0EA5E9` |
| 10 | `economia` | `balance` | `#14B8A6` |
| 11 | `cultura` | `flag` | `#EC4899` |
| 12 | `emergencia` | `sos` | `#DC2626` |
| 13 | `justicia` | `balance` | `#7C3AED` |
| 14 | `conocimiento` | `microscope` | `#0891B2` |

**Regla normativa (la más importante de esta sección):**

> El campo `category` **DEBE** contener uno de estos 14 identificadores, **exactamente** como están escritos (minúsculas, sin acentos, sin espacios). Una implementación conforme **NO DEBE** inventar identificadores propios para el contenido que intercambia, **NO DEBE** traducirlos y **NO DEBE** sustituirlos por etiquetas legibles. `category` es el eje sobre el que se produce el emparejamiento problema ↔ capacidad entre nodos; dos nodos que usen vocabularios distintos pueden describir el mismo problema y **nunca emparejarlo**.

Directrices asociadas:

| Aspecto | Norma |
|---|---|
| Categoría desconocida | Si un registro entrante trae un `category` fuera de la lista, la implementación **PUEDE** aceptarlo (no invalida el registro ni la firma) pero **DEBERÍA** mostrarlo con una advertencia y **NO DEBE** reescribirlo ni mapearlo silenciosamente a otra categoría. La firma cubre `category`: reescribirlo rompe la verificación. |
| Ampliaciones | Una implementación **PUEDE** definir categorías adicionales para su uso interno, pero **DEBE** mantenerlas en un espacio de nombres separado y **NO DEBE** emitirlas en paquetes destinados a otros nodos. |
| `icon` y `color` | Son **presentación**, no protocolo. Una implementación **PUEDE** ignorarlos. `icon` referencia claves de un catálogo SVG interno, no un estándar. |
| Etiquetas | La etiqueta legible se obtiene por convención de la clave de traducción `cat.<id>` en `js/locales/*.js`. Traducir la etiqueta **NO DEBE** cambiar el `id` almacenado o transmitido. |
| Precarga | Si la taxonomía no se puede cargar, la referencia usa un respaldo de 4 categorías (`salud`, `agua`, `energia`, `tecnologia`). Una implementación conforme **DEBE** preferir la lista completa. |

---

## 9. Paquetes de intercambio

El formato principal del protocolo tiene nombre propio: **PKE — Pangea Knowledge
Exchange** es el sobre JSON identificado por `format: "pangea-exchange"`, el que
transporta las quince colecciones completas. Es el formato que una
implementación debe saber leer para considerarse compatible, y el único que
`Store.exportAll()` produce y `Store.importAll()` acepta de forma genérica.

Los demás formatos del protocolo son **paquetes de propósito específico**
(emergencias, archivo, diccionario, afirmaciones) que viajan con el mismo
principio —un JSON que un humano puede abrir y un programa puede verificar— pero
cada uno con su propio importador, porque cada uno valida cosas distintas.

Resumen de formatos:

| `format` | Contenedor | Firmado | MIME | Nombre de archivo |
|---|---|---|---|---|
| `pangea-exchange` (**PKE**) | JSON | No en sí mismo (los registros pueden estarlo) | `application/json` | sin convención fija (viaja como `data.json` dentro del pasaporte) |
| `pangea-passport` | ZIP (`.pangea.zip`) | Manifiesto firmado; `data.json` no | `application/zip` | `pangea-passport-YYYY-MM-DD.pangea.zip` |
| `pangea-sos` | JSON | Sí, el paquete completo | `application/json` | `pangea-sos-{prefijo-}YYYY-MM-DD.json` |
| `pangea-memoria` | ZIP (`.zip`) | Manifiesto firmado (con `sig` **y** `signature`) | `application/zip` | `pangea-memoria-YYYY-MM-DD.zip` |
| `pangea-lingua-dictionary` | JSON | **No** a nivel de paquete | `application/json` | `pangea-diccionario-YYYY-MM-DD.json` |
| `pangea-phrasebook` | JSON (recurso interno) | No | `application/json` | `data/frases-emergencia.json` |
| `pangea-synapse` | JSON | **No** | `application/json` | `pangea-synapse-YYYY-MM-DD.json` |
| `pangea-veritas-claim` | JSON | **No** a nivel de paquete | `application/json` | `veritas-{claimId[0..24]}.json` |
| `PANGEA-ID-1` | JSON cifrado | No (es un sobre cifrado autenticado por GCM) | `application/json` | `pangea-identity-{huella}.json` |

`YYYY-MM-DD` es siempre la **fecha UTC** (`new Date().toISOString().slice(0, 10)`).

### 9.1 `pangea-exchange` (**PKE**) — exportación completa

Producido por `Store.exportAll({ includeIdentity = false })`. Es el formato de **intercambio total**: incluye **las 15 colecciones** de la implementación de referencia, contadores, metadatos y la lista de lo omitido. Este es el formato que define el nombre **PKE (Pangea Knowledge Exchange)**: cualquier herramienta que lea y escriba este sobre puede intercambiar conocimiento con PANGEA y entre nodos, sin ejecutar la aplicación.

| Campo | Tipo | Descripción |
|---|---|---|
| `format` | string | `"pangea-exchange"` — el identificador del **PKE** |
| `spec` | string | `"1.0"` |
| `app` | string | `"PANGEA"` |
| `exportedAt` | string | Fecha ISO-8601 del momento de exportación. |
| `counts` | object | Un contador por colección: `{ problems: n, capacities: n, …, telemetry: 0 }`, en el mismo orden que las colecciones. Los contadores **ya reflejan las omisiones**: `identity` y `telemetry` valen `0`, y `settings` cuenta solo las preferencias no secretas. |
| `omitted` | array\<string\> | **Lista de lo que se dejó fuera a propósito.** Valores posibles y **orden exacto** en que el código los añade: `"settings:secretos"` (se filtró una o más claves de `Store.SENSITIVE_SETTINGS`; la colección `settings` es la 13.ª del recorrido), después `"identity"` (la colección entera se excluye cuando `includeIdentity` es falso; es la 14.ª) y `"telemetry"` (nunca se transporta; es la 15.ª). Vacía (`[]`) si no se omitió nada. Un receptor **PUEDE** mostrarla; **NO DEBE** interpretarla como un error. |
| `collections` | object | Mapa `nombre_de_colección → array de registros`. **Todas** las claves están siempre presentes, aunque el array esté vacío. |

**Qué se excluye por omisión, y con qué opción se incluye:**

| Omisión | Cómo se decide | Valor con la opción contraria |
|---|---|---|
| Colección `identity` completa (contiene `priv`, la clave privada **en claro**) | `Store.exportAll()` la excluye **siempre** salvo que se pase `includeIdentity: true`. Cuando se excluye, `collections.identity` es `[]`, `counts.identity` es `0` y `omitted` incluye `"identity"`. | `exportAll({ includeIdentity: true })` la incluye. La interfaz de referencia **nunca** pasa esa opción: la clave privada solo sale por `PANGEA-ID-1` (§5.2). |
| Colección `telemetry` completa (contadores diarios locales) | Se excluye **siempre**, sin opción que la incluya: está en `Store.NEVER_EXPORTED` junto con `identity`. `collections.telemetry` es `[]`, `counts.telemetry` es `0` y `omitted` incluye `"telemetry"`. | Ninguno. La promesa del proyecto es que la telemetría nunca sale del dispositivo, y un paquete puede acabar en un nodo comunitario ajeno (§15.6). |
| Claves secretas dentro de `settings` | Se filtran las de `Store.SENSITIVE_SETTINGS` (`pref.llm.key`, `pref.translate.endpoint.token`). `omitted` incluye `"settings:secretos"`. | Ninguno: una clave de API es un secreto y no debe viajar en un archivo que se comparte. |
| Preferencias secretas de `settings` | Se descartan las filas cuyo `id` esté en `Store.SENSITIVE_SETTINGS` = `['pref.llm.key', 'pref.translate.endpoint.token']`. No hay opción para incluirlas: **no se exportan nunca**. Si se descartó al menos una, `omitted` incluye `"settings:secretos"`. | No existe. |

Ejemplo (recortado):

```json
{
  "format": "pangea-exchange",
  "spec": "1.0",
  "app": "PANGEA",
  "exportedAt": "2026-09-10T12:34:56.789Z",
  "counts": {
    "problems": 1, "capacities": 1, "matches": 1, "claims": 1, "votes": 1,
    "knowledge": 1, "curations": 0, "alerts": 1, "responses": 0, "vocab": 1,
    "agents": 1, "events": 3, "settings": 4, "identity": 0, "telemetry": 0
  },
  "omitted": ["settings:secretos", "identity", "telemetry"],
  "collections": {
    "problems": [
      {
        "createdAt": 1735689600000,
        "id": "prob_1a2b3c4d5e",
        "kind": "problem",
        "status": "abierto",
        "title": "El agua de la red llega contaminada dos dias por semana",
        "body": "Necesitamos un filtro de bajo costo y como verificar el agua.",
        "category": "agua",
        "urgency": "high",
        "location": { "label": "Cali, Colombia", "lat": 3.4516, "lng": -76.532 },
        "tags": ["agua", "filtro"],
        "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false },
        "lang": "es",
        "sig": {
          "sig": "PuLVfIR1LNEepYutAEH2zP0UnBUivnMFnpN3Mh625sfNAYl4+tA92w1O85G9tFMprRgA8Wd+89Qy97VuZwVH0g==",
          "pub": "{\"key_ops\":[\"verify\"],\"ext\":true,\"kty\":\"EC\",\"x\":\"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0\",\"y\":\"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU\",\"crv\":\"P-256\"}",
          "fp": "PAN-ML72-N5P6-UFPK",
          "alg": "ECDSA-P256-SHA256",
          "at": 1735689700000
        },
        "updatedAt": 1735689700000
      }
    ],
    "capacities": [],
    "matches": [],
    "claims": [],
    "votes": [],
    "knowledge": [],
    "curations": [],
    "alerts": [],
    "responses": [],
    "vocab": [],
    "agents": [],
    "events": [],
    "settings": [],
    "identity": [],
    "telemetry": []
  }
}
```

> **Garantía de privacidad (normativa).** Un `pangea-exchange` producido por la referencia **no contiene la clave privada ni claves de API**: la colección `identity` se excluye por omisión y `pref.llm.key` / `pref.translate.endpoint.token` se filtran siempre. Una implementación conforme **DEBE** comportarse igual: **NO DEBE** escribir la clave privada en ningún paquete de datos (§15.7) y **DEBE** declarar en `omitted` lo que haya dejado fuera. Si una implementación ofrece una opción para incluir la identidad, **DEBE** estar desactivada por omisión y **DEBE** advertirse explícitamente y con lenguaje inequívoco antes de usarla.

> **Aviso al receptor (normativa).** `pangea-exchange` **no** está firmado como paquete: la integridad depende de la firma individual de cada registro (§4.4). El receptor **DEBE** verificar registro a registro y **NO DEBE** presentar como auténtico un registro sin firma o cuya firma no verifique. Un importador genérico **DEBE** rechazar cualquier archivo cuyo `format` no sea `pangea-exchange` (§11.1) y **NO DEBE** importar nunca la colección `identity`.

> **Nota de fidelidad (telemetría).** La colección `telemetry` está en la lista `Store.NEVER_EXPORTED` y **nunca** se incluye en `pangea-exchange`: `collections.telemetry` es `[]`, `counts.telemetry` es `0` y `omitted` la enumera. Es coherente con §15.6, que prohíbe transportar telemetría en un paquete.

### 9.2 `pangea-passport` — pasaporte `.pangea.zip`

**Contenedor:** archivo ZIP (§10) con exactamente tres entradas, en este orden: `manifest.json`, `data.json`, `README.txt`.

**`manifest.json`** — objeto firmado. Contenido firmado = la proyección canónica del manifiesto completo (con `sig` excluido por `NOT_SIGNED`, §3.3).

| Campo | Tipo | ¿Firmado? | Descripción |
|---|---|---|---|
| `format` | string | **Sí** | `"pangea-passport"` |
| `spec` | string | **Sí** | `"1.0"` |
| `app` | string | **Sí** | `"PANGEA"` |
| `version` | string | **Sí** | Versión de la aplicación, `"1.0.0"` |
| `exportedAt` | string | **Sí** | ISO-8601 |
| `identity` | object\|null | **Sí** | `{ fingerprint, name, pub }` o `null` si no hay identidad. **No** incluye `priv`. |
| `counts` | object | **Sí** | Copia de `data.counts`. |
| `sig` | object | **No** (exclusión recursiva) | Sobre de firma del manifiesto. Ausente si no hay identidad local. |

**`data.json`** — un objeto `pangea-exchange` completo, **sin firmar a nivel de paquete** (§9.1). Contiene las quince claves de colección, pero **`identity` va vacía**: la clave privada **no** viaja en el pasaporte. `settings` llega sin `pref.llm.key` ni `pref.translate.endpoint.token`, y `data.omitted` enumera lo omitido (`["identity"]`, y `"settings:secretos"` si se filtró alguno). La integridad de sus registros depende de las firmas individuales.

> **Normativo (crítico).** El pasaporte **NO DEBE** contener la clave privada. Lo único que el pasaporte dice de la identidad es el manifiesto firmado, que incluye **solo** `{ fingerprint, name, pub }` —la clave **pública**—. La identidad completa (con `priv`) viaja **exclusivamente** por el sobre cifrado `PANGEA-ID-1` (§5). Un pasaporte que traiga `collections.identity` con filas, o `priv` en cualquier parte, **DEBE** rechazarse y **DEBE** reportarse como fuga.

**`README.txt`** — texto plano en UTF-8, no normativo, con fines de ayuda humana. Contenido exacto generado por la referencia (los valores variables se sustituyen en el momento de exportar):

```text
PANGEA · PASAPORTE DE INTELIGENCIA COLECTIVA
=============================================

Este archivo contiene tus contribuciones, tu reputación firmada y tus
ajustes. Es tuyo: nadie más lo controla.

Huella: PAN-ML72-N5P6-UFPK
Exportado: 2026-09-10T12:34:56.789Z
Firma: PuLVfIR1LNEepYutAEH2zP0UnBUivnMFnpN3Mh625sfNAYl4…

QUÉ NO CONTIENE, Y POR QUÉ
--------------------------
Tu CLAVE PRIVADA no viaja en este archivo. Un pasaporte está pensado para
llevarse en un USB o compartirse, así que incluir la clave privada aquí la
expondría en claro. La identidad se exporta aparte, cifrada con contraseña,
desde NEXUS ID → Exportar identidad cifrada (formato PANGEA-ID-1).
Tampoco se incluyen las claves de API que hayas configurado.

Cómo usarlo:
  1. Abre PANGEA en cualquier dispositivo.
  2. Ve a NEXUS ID → Importar datos y selecciona este archivo .zip
     (o el data.json que contiene dentro).
  3. Para recuperar tu IDENTIDAD, usa el archivo PANGEA-ID-1 y su
     contraseña, en NEXUS ID → Importar identidad.

Formato abierto y documentado en docs/PROTOCOLO-PANGEA.md.
Código bajo licencia MIT · Contenido bajo Creative Commons BY-SA.
```

Detalles de formato del README: la línea de firma muestra los **primeros 48 caracteres** del Base64 de la firma seguidos de `…`, o el literal `no firmado`; la línea de huella muestra `sin identidad` si `identity` es `null`. Las líneas se unen con `\n` (LF), sin BOM. El bloque «**QUÉ NO CONTIENE, Y POR QUÉ**» se escribe **en mayúsculas deliberadamente**, porque es la advertencia que el usuario debe leer antes de compartir el archivo.

**Ejemplo de `manifest.json`:**

```json
{
  "format": "pangea-passport",
  "spec": "1.0",
  "app": "PANGEA",
  "version": "1.0.0",
  "exportedAt": "2026-09-10T12:34:56.789Z",
  "identity": {
    "fingerprint": "PAN-ML72-N5P6-UFPK",
    "name": "Ana Ruiz",
    "pub": "{\"key_ops\":[\"verify\"],\"ext\":true,\"kty\":\"EC\",\"x\":\"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0\",\"y\":\"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU\",\"crv\":\"P-256\"}"
  },
  "counts": { "problems": 1, "capacities": 1, "matches": 1, "claims": 1, "votes": 1, "knowledge": 1, "curations": 0, "alerts": 1, "responses": 0, "vocab": 1, "agents": 1, "events": 3, "settings": 4, "identity": 0, "telemetry": 0 },
  "sig": {
    "sig": "…64 bytes en Base64…",
    "pub": "{\"key_ops\":[\"verify\"],\"ext\":true,\"kty\":\"EC\",\"x\":\"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0\",\"y\":\"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU\",\"crv\":\"P-256\"}",
    "fp": "PAN-ML72-N5P6-UFPK",
    "alg": "ECDSA-P256-SHA256",
    "at": 1735689700000
  }
}
```

**Qué está firmado y qué no:**

| Parte | ¿Firmado? | Consecuencia |
|---|---|---|
| `manifest.json` completo (menos `sig`) | **Sí**, por el propio titular | Prueba quién exportó, cuándo, con qué recuentos, y cuál era su clave **pública**. Cubre los campos `format`, `spec`, `app`, `version`, `exportedAt`, `identity` (`{fingerprint, name, pub}`) y `counts`. |
| `manifest.identity` | **Sí** (dentro del manifiesto) | Contiene **solo** la clave pública `pub`, la huella y el nombre. **Nunca** `priv`: ver la nota normativa anterior. |
| `data.json` (contenido) | **No** como archivo | Si alguien recorta registros de `data.json`, la firma del manifiesto **sigue siendo válida** y los `counts` del manifiesto ya no coincidirán con el contenido. Un verificador **DEBERÍA** comparar `manifest.counts` con los recuentos reales de `data.json`, avisar de la discrepancia y comprobar que `data.collections.identity` está vacía. |
| `data.omitted` | **No** | Declaración informativa de lo que se dejó fuera. **NO DEBE** firmarse ni interpretarse como prueba: un atacante puede borrarla o falsificarla. Lo que importa es que `identity` esté efectivamente vacía. |
| Cada registro dentro de `data.json` | **Sí, individualmente**, si se publicó con identidad | La integridad real del contenido descansa aquí. |
| `README.txt` | **No** | Texto de ayuda. Se **DEBE** ignorar en la verificación. |

> **Verificación de que el pasaporte no lleva la identidad (recomendada).** Un receptor **DEBERÍA** comprobar dos cosas antes de aceptar un pasaporte: (a) `data.collections.identity` está vacía o ausente; (b) ningún objeto anidado de `data.json` contiene una clave `priv`. La segunda comprobación es la que detecta un pasaporte manipulado que esconda la clave en otra colección.

**Comportamiento del importador de referencia:** al leer un `.zip` o `.pangea`, busca una entrada llamada exactamente `data.json`; si no existe, lanza `El archivo no contiene data.json`. Si hay `manifest.json`, lo parsea y verifica con `Crypto.verify(manifiesto)` mostrando el resultado como aviso, **pero importa igual** aunque la verificación falle. Si el manifiesto no es legible, se ignora en silencio. El contenido se entrega a `Store.importAll()` (§11), que **ignora la colección `identity`** aunque viniera con filas y lo reporta en `identitySkipped`.

### 9.3 `pangea-sos` — transporte de alertas sin red

Paquete firmado **completo** (no solo sus alertas). Nace de exportar todas las alertas de un nodo, o una sola (con sufijo en el nombre de archivo igual a los primeros 8 caracteres del `id` de la alerta).

| Campo | Tipo | ¿Firmado? | Descripción |
|---|---|---|---|
| `format` | string | **Sí** | `"pangea-sos"` — validado literalmente al importar. |
| `spec` | string | **Sí** | `"1.0"` |
| `exportedAt` | string | **Sí** | ISO-8601 |
| `origin` | object | **No** | `{ fingerprint: string, name: string }` del exportador. **Clave crítica:** `origin` está en `NOT_SIGNED` (§3.3), de modo que **la firma del paquete no cubre `origin`**. Un importador **DEBE** obtener la huella del emisor de `sig.pub` (recalculando) y **NO DEBE** confiar en `origin.fingerprint`. |
| `alerts` | array\<object\> | **Sí, solo su contenido proyectado** | Las alertas completas de §7.8. La firma del paquete cubre **lo que sobrevive a la proyección canónica** (§3.3, recursiva): el contenido de cada alerta, más su **posición** en el array (los arrays conservan el orden). Como `NOT_SIGNED` se aplica en todos los niveles, la firma del paquete **NO cubre** el `id`, `createdAt`, `updatedAt`, `status`, `origin`, `importedFrom` ni `confirmations` de las alertas anidadas: esos campos **PUEDEN** cambiar sin romper la firma del paquete, igual que sin romper la firma de la alerta (§3.4). |
| `sig` | object | **No** (exclusión recursiva) | Sobre de firma del paquete. Ausente si no había identidad al exportar. |

```json
{
  "format": "pangea-sos",
  "spec": "1.0",
  "exportedAt": "2026-09-10T12:34:56.789Z",
  "origin": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz" },
  "alerts": [
    {
      "createdAt": 1735689600000,
      "id": "alert_5x6y7z8w9v",
      "type": "natural",
      "severity": "critical",
      "title": "Desbordamiento del río en el barrio sur",
      "body": "El agua subió 1,5 m en dos horas. Hay 40 familias aisladas.",
      "location": { "lat": 3.4516, "lng": -76.532, "label": "Cali, barrio Sur" },
      "status": "activa",
      "confirmations": ["PAN-ABCD-EFGH-JKLM"],
      "origin": "local",
      "importedFrom": null,
      "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false },
      "lang": "es",
      "sig": { "sig": "…", "pub": "…", "fp": "PAN-ML72-N5P6-UFPK", "alg": "ECDSA-P256-SHA256", "at": 1735689650000 },
      "updatedAt": 1735689700000
    }
  ],
  "sig": {
    "sig": "…64 bytes en Base64…",
    "pub": "{\"key_ops\":[\"verify\"],\"ext\":true,\"kty\":\"EC\",\"x\":\"…\",\"y\":\"…\",\"crv\":\"P-256\"}",
    "fp": "PAN-ML72-N5P6-UFPK",
    "alg": "ECDSA-P256-SHA256",
    "at": 1735689700000
  }
}
```

**Normalización del importador de referencia (aplicada registro por registro):**

| Campo | Regla aplicada |
|---|---|
| `id` | Si no es cadena no vacía → el registro se **descarta**. Si el `id` ya existe localmente → se **descarta** (deduplicación, sin sobrescribir). |
| `type` | Si no está en la lista → `"other"`. |
| `severity` | Si no está en la lista → `"medium"`. |
| `title` | Cadena recortada a 160 caracteres; si queda vacía → el `id`. |
| `body` | Cadena recortada a 2000 caracteres. |
| `location` | Se valida numéricamente; si `lat`/`lng` no son finitos o están fuera de ±90/±180 → `null`. `label` recortado a 120. |
| `status` | `"atendida"` se conserva; cualquier otro valor → `"activa"`. |
| `confirmations` | Solo cadenas, recortado a 500 elementos. |
| `origin` | **Se reescribe** a `"imported"`. |
| `importedFrom` | Huella del paquete (recalculada desde `sig.pub` si es posible; si no, `sig.fp`; si no, `origin.fingerprint`). |
| `createdAt` | Se conserva; si falta → `Date.now()`. |
| `updatedAt` | **Se reescribe al momento de la importación** por el almacén. |
| Cualquier otro campo | **Se conserva** (el registro se copia y se sobrescriben solo los campos anteriores). |
| Firma del registro | Se verifica **antes** de añadir la procedencia local y el resultado se cuenta, pero **no** bloquea la importación. |

### 9.4 `pangea-memoria` — archivo ZIP de conocimiento

**Contenedor:** ZIP (§10) con las entradas `manifest.json`, `knowledge.json` y `curations.json`.

**`manifest.json`** — firmado, y **el sobre aparece dos veces**, con los mismos bytes, bajo las claves `sig` y `signature`:

```json
{
  "format": "pangea-memoria",
  "spec": "1.0",
  "exportedAt": "2026-09-10T12:34:56.789Z",
  "counts": { "knowledge": 1, "curations": 0 },
  "sig": { "sig": "…", "pub": "…", "fp": "PAN-ML72-N5P6-UFPK", "alg": "ECDSA-P256-SHA256", "at": 1735689700000 },
  "signature": { "sig": "…", "pub": "…", "fp": "PAN-ML72-N5P6-UFPK", "alg": "ECDSA-P256-SHA256", "at": 1735689700000 }
}
```

Si no hay identidad, el manifiesto se escribe con `"signature": null` y sin `sig`.

> **Normativo: cómo reconstruir exactamente lo firmado.** Lo firmado fue **el objeto base de cuatro campos**, no el manifiesto con los sobres. El verificador **DEBE** construir
> `base = { format, spec, exportedAt, counts }`
> copiando **exactamente** esos cuatro valores del manifiesto, y verificar la firma sobre `canonical(base)`, usando como sobre `manifest.signature || manifest.sig`. Cualquier otro campo del manifiesto (`sig`, `signature`) se excluye de todos modos por `NOT_SIGNED` (§3.3), por lo que verificar el manifiesto completo con el sobre adjunto produce el mismo resultado —y, con una sola lista recursiva, esa equivalencia se cumple sin depender del nivel en que esté la clave—; pero la construcción explícita de `base` es la que documenta el código y la que **DEBE** usarse si el manifiesto llegara con campos adicionales desconocidos (esos campos **no** estaban cuando se firmó, y `base` los ignora).

**`knowledge.json`** y **`curations.json`** — envoltorios por colección, sin firma propia. `records[]` lleva registros completos de §7.6 y §7.7 respectivamente; en los ejemplos se muestra vacío para que sean JSON válido:

```json
{ "format": "pangea-memoria", "spec": "1.0", "collection": "knowledge", "records": [] }
```

```json
{ "format": "pangea-memoria", "spec": "1.0", "collection": "curations", "records": [] }
```

**Importación tolerante (formatos aceptados por `readCollection`).** Para extraer registros, la referencia acepta cualquiera de estas formas, en este orden de comprobación:

1. El valor ya es un array → se usa tal cual.
2. Tiene `records` y es array → se usa `records`.
3. Tiene `collections[name]` y es array → se usa.
4. Tiene `[name]` y es array → se usa.
5. En otro caso → lista vacía.

Además, para entradas del ZIP se acepta un nombre con prefijo de carpeta (`…/manifest.json`). Si el archivo **no** es un ZIP, se acepta también un JSON único que contenga `manifest` y/o `collections.knowledge`/`collections.curations`. Un ZIP sin `manifest.json` o sin `knowledge.json` **no** provoca error: se importa lo que haya y se marca el resultado como no verificado.

### 9.5 `pangea-lingua-dictionary` — diccionario vivo

| Campo | Tipo | Descripción |
|---|---|---|
| `format` | string | `"pangea-lingua-dictionary"` |
| `spec` | string | `"1.0"` |
| `exportedAt` | string | ISO-8601 |
| `languages` | array\<object\> | `[{ code, name, native }]` para los 12 idiomas de LINGUA, en el orden fijo `es, en, pt, fr, it, de, ar, hi, zh, ja, ru, sw`. |
| `words` | array\<object\> | Registros `vocab` completos (§7.10), ordenados por `createdAt` descendente. **No hay firma de paquete.** |

```json
{
  "format": "pangea-lingua-dictionary",
  "spec": "1.0",
  "exportedAt": "2026-09-10T12:34:56.789Z",
  "languages": [
    { "code": "es", "name": "Español", "native": "Español" },
    { "code": "en", "name": "English", "native": "English" },
    { "code": "pt", "name": "Português", "native": "Português" },
    { "code": "fr", "name": "Français", "native": "Français" },
    { "code": "it", "name": "Italiano", "native": "Italiano" },
    { "code": "de", "name": "Deutsch", "native": "Deutsch" },
    { "code": "ar", "name": "العربية", "native": "العربية" },
    { "code": "hi", "name": "हिन्दी", "native": "हिन्दी" },
    { "code": "zh", "name": "中文", "native": "中文" },
    { "code": "ja", "name": "日本語", "native": "日本語" },
    { "code": "ru", "name": "Русский", "native": "Русский" },
    { "code": "sw", "name": "Kiswahili", "native": "Kiswahili" }
  ],
  "words": [
    {
      "createdAt": 1735689600000,
      "id": "voc_a1b2c3d4e5",
      "word": "yaku",
      "meaning": "agua",
      "dialect": "kichwa de Imbabura",
      "speaker": "María T.",
      "lang": "es",
      "audio": "data:audio/webm;base64,GkXfo59Ch…",
      "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false },
      "sig": { "sig": "…", "pub": "…", "fp": "PAN-ML72-N5P6-UFPK", "alg": "ECDSA-P256-SHA256", "at": 1735689700000 },
      "updatedAt": 1735689700000
    }
  ]
}
```

Nota de interoperabilidad: la referencia **exporta** este formato pero **no tiene importador** para él. Un consumidor debe leer `words[]` y verificar cada firma individualmente con §4.4; el sobre de paquete no existe.

### 9.6 `pangea-phrasebook` — fraseo de emergencia sin conexión

Recurso interno (`data/frases-emergencia.json`), cargado por LINGUA al montar el módulo. No tiene exportador ni importador en la interfaz, pero su forma es estable y **DEBE** respetarse si una implementación quiere aportar un libro de frases.

| Campo | Tipo | Descripción |
|---|---|---|
| `version` | number | Versión del recurso: `1`. |
| `format` | string | `"pangea-phrasebook"` |
| `note` | string | Comentario humano, no normativo. |
| `languages` | array\<string\> | `["es","en","pt","fr","it","de","ar","hi","zh","ja","ru","sw"]` |
| `phrases` | array\<object\> | Cada frase es un objeto con `id` **más una clave por idioma**, cuyo valor es la frase traducida. |

Algoritmo de uso (normativo si se implementa el fraseo local): normalizar a minúsculas, quitar diacríticos (NFD + eliminación de `U+0300–U+036F`), quitar `¿?¡!.,;:` y colapsar espacios; primero buscar coincidencia exacta sobre la frase del idioma de origen; si no, puntuar por proporción de tokens coincidentes y aceptar si la mejor puntuación es **≥ 0.75**.

Las 14 frases semilla y sus `id`: `ayuda`, `medico`, `agua`, `comida`, `refugio`, `hospital`, `peligro`, `ninos`, `herido`, `perdido`, `medicinas`, `transporte`, `gracias`, `hola`.

```json
{
  "version": 1,
  "format": "pangea-phrasebook",
  "languages": ["es", "en", "pt", "fr", "it", "de", "ar", "hi", "zh", "ja", "ru", "sw"],
  "phrases": [
    {
      "id": "ayuda",
      "es": "Necesito ayuda",
      "en": "I need help",
      "pt": "Preciso de ajuda",
      "fr": "J'ai besoin d'aide",
      "it": "Ho bisogno di aiuto",
      "de": "Ich brauche Hilfe",
      "ar": "أحتاج إلى مساعدة",
      "hi": "मुझे मदद चाहिए",
      "zh": "我需要帮助",
      "ja": "助けが必要です",
      "ru": "Мне нужна помощь",
      "sw": "Nahitaji msaada"
    }
  ]
}
```

> **Normativo.** Las frases se localizan **como frase completa**, nunca palabra por palabra. Un `id` de frase **NO DEBE** cambiar de significado entre versiones; para añadir una frase nueva se añade un `id` nuevo.

### 9.7 `pangea-synapse` — exportación del tablero (no firmada)

| Campo | Tipo | Descripción |
|---|---|---|
| `format` | string | `"pangea-synapse"` |
| `spec` | string | `"1.0"` |
| `exportedAt` | string | ISO-8601 |
| `problems` | array\<object\> | §7.1, orden `createdAt` descendente |
| `capacities` | array\<object\> | §7.2, orden `createdAt` descendente |
| `matches` | array\<object\> | §7.3, orden `createdAt` descendente |

**No lleva firma de paquete** y la referencia **no tiene importador** para él. Sus claves (`problems`, `capacities`, `matches`) **coinciden con nombres de colección**, pero eso **no** basta para colarlo por el importador genérico: `Store.importAll()` **rechaza** cualquier archivo cuyo `format` no sea `pangea-exchange` (§11.1), precisamente para que cada formato pase por su importador, que valida la firma y marca la procedencia. Un integrador que quiera consumirlo **DEBE** implementar su propio lector y verificar cada registro con §4.4.

### 9.8 `pangea-veritas-claim` — expediente auditable de una afirmación (no firmado)

| Campo | Tipo | Descripción |
|---|---|---|
| `format` | string | `"pangea-veritas-claim"` |
| `spec` | string | `"1.0"` |
| `app` | string | `"PANGEA"` |
| `exportedAt` | string | ISO-8601 |
| `claim` | object | La afirmación completa (§7.4). |
| `votes` | array\<object\> | Todos los votos de esa afirmación (§7.5). |
| `weights` | object | Los pesos usados: `{ "true": 1, "false": -1, "context": 0.35, "unverifiable": 0 }`. **Se incluyen para que el cálculo sea reproducible por un tercero.** |
| `consensus` | object | `{ weightedSum, denominator, agreement, pct, status, counts }` |
| `anomaly` | object | `{ flagged, burstCount, burstShare, distinctEvidence, uniqueEvidenceRatio, rapidCount, rapidFire, suspiciousIds }` |
| `credibility` | object | `{ value, base, evidenceQuality, sourceBonus, anomalyPenalty }` |

Parámetros del cálculo (declarados aquí para reproducibilidad; son **política**, no protocolo): ventana de ráfaga de 90 000 ms, ventana de fuego rápido de 20 000 ms, umbral de anomalía `(burstShare > 0.5 && votos >= 4) || uniqueEvidenceRatio < 0.4 || rapidFire` con `rapidFire = (3 votos o más en 20 s)`, penalización de anomalía 25 puntos, `base = min(45, round(log2(votos+1)·12))`, `evidenceQuality = min(25, round(media_longitud_evidencia/8))`, `sourceBonus = min(15, fuentes_totales·3)`.

```json
{
  "format": "pangea-veritas-claim",
  "spec": "1.0",
  "app": "PANGEA",
  "exportedAt": "2026-09-10T12:34:56.789Z",
  "claim": { "id": "clai_7g8h9j0k", "text": "El agua de la red…", "category": "agua", "status": "abierta", "sources": [], "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false }, "lang": "es", "sig": { "…": "…" } },
  "votes": [],
  "weights": { "true": 1, "false": -1, "context": 0.35, "unverifiable": 0 },
  "consensus": { "weightedSum": 0, "denominator": 0, "agreement": 0, "pct": 0, "status": "abierta", "counts": { "true": 0, "false": 0, "context": 0, "unverifiable": 0 } },
  "anomaly": { "flagged": false, "burstCount": 0, "burstShare": 0, "distinctEvidence": 0, "uniqueEvidenceRatio": 1, "rapidCount": 0, "rapidFire": false, "suspiciousIds": [] },
  "credibility": { "value": 0, "base": 0, "evidenceQuality": 0, "sourceBonus": 0, "anomalyPenalty": 0 }
}
```

### 9.9 `pangea.statement` — firma de un texto cualquiera

Forma mínima del protocolo, útil para pruebas de interoperabilidad y para firmar declaraciones fuera de cualquier colección:

```json
{
  "kind": "pangea.statement",
  "text": "…texto firmado…",
  "at": "2026-09-10T12:34:56.789Z",
  "sig": { "sig": "…", "pub": "…", "fp": "PAN-ML72-N5P6-UFPK", "alg": "ECDSA-P256-SHA256", "at": 1757511296789 }
}
```

`at` es aquí una **cadena ISO-8601** (a diferencia de `sig.at`, que es numérico) y **sí** forma parte del contenido firmado. Mínimo 4 caracteres de texto al firmar desde la interfaz. Se verifica con §4.4 sin ninguna regla adicional.

---

## 10. Formato de archivo ZIP propio

La implementación de referencia escribe y lee ZIP sin bibliotecas externas. El subconjunto usado es deliberadamente mínimo: **método 0 (sin compresión)**, sin ZIP64, sin cifrado, sin descriptores de datos, sin comentarios. Cualquier lector ZIP estándar puede leer los archivos generados; cualquier escritor estándar puede producir archivos que la referencia lea, siempre que use método 0.

### 10.1 Requisitos globales

| Requisito | Valor |
|---|---|
| Método de compresión | **0 (stored)**. La referencia ignora silenciosamente cualquier entrada con otro método (no la devuelve). |
| Firma local | `0x04034B50` |
| Firma del directorio central | `0x02014B50` |
| Firma del fin del directorio central (EOCD) | `0x06054B50` |
| Versión necesaria / creadora | `20` (ZIP 2.0) |
| Indicadores generales (flags) | **`0x0800`** — bit 11, «el nombre del archivo está codificado en UTF-8». No se usan otros bits. |
| Nombres | Codificados en **UTF-8**; longitud en bytes (no en caracteres). |
| Marca de tiempo | DOS: una sola marca para **todas** las entradas del archivo, tomada del reloj en el momento de crear el ZIP. |
| Tamaños | 32 bits. Sin ZIP64: cada entrada **DEBE** ser menor de 4 GiB y el archivo total también. |
| Entradas | Máximo 65 535 (campo de 16 bits). |
| Comentarios, campos extra, atributos | Longitud **0**; atributos internos y externos **0**; número de disco **0**. |
| CRC-32 | Obligatorio y verificado por lectores estándar. |

### 10.2 Registro de cabecera local (30 bytes + nombre + datos)

Escrito en orden little-endian:

| Desplazamiento | Bytes | Campo | Valor escrito |
|---|---|---|---|
| 0 | 4 | Firma | `0x04034B50` |
| 4 | 2 | Versión necesaria | `20` |
| 6 | 2 | Indicadores | `0x0800` |
| 8 | 2 | Método de compresión | `0` |
| 10 | 2 | Hora DOS | `((horas << 11) \| (minutos << 5) \| (segundos / 2)) & 0xFFFF` |
| 12 | 2 | Fecha DOS | `(((año − 1980) << 9) \| ((mes + 1) << 5) \| día) & 0xFFFF` |
| 14 | 4 | CRC-32 | CRC-32 de los datos **sin comprimir** |
| 18 | 4 | Tamaño comprimido | `n` (igual que el sin comprimir: método 0) |
| 22 | 4 | Tamaño sin comprimir | `n` |
| 26 | 2 | Longitud del nombre | bytes del nombre en UTF-8 |
| 28 | 2 | Longitud del campo extra | `0` |
| 30 | L | Nombre | bytes UTF-8 |
| 30+L | n | Datos | contenido de la entrada |

`segundos / 2` es una **división real**, no entera: el valor (p. ej. `15.5`) se trunca hacia cero al convertirlo a entero de 32 bits por el operador `|` (OR bit a bit), de modo que un segundo **impar** se codifica como el par anterior (31 s → 15 unidades DOS → 30 s). Es una peculiaridad del código que no afecta a la interoperabilidad (la marca de tiempo ZIP no es normativa para el contenido), pero una reimplementación que redondee en lugar de truncar producirá archivos que un lector estándar acepta igualmente.

### 10.3 Registro del directorio central (46 bytes + nombre)

| Desplazamiento | Bytes | Campo | Valor escrito |
|---|---|---|---|
| 0 | 4 | Firma | `0x02014B50` |
| 4 | 2 | Versión creadora | `20` |
| 6 | 2 | Versión necesaria | `20` |
| 8 | 2 | Indicadores | `0x0800` |
| 10 | 2 | Método | `0` |
| 12 | 2 | Hora DOS | idéntica a la cabecera local |
| 14 | 2 | Fecha DOS | idéntica a la cabecera local |
| 16 | 4 | CRC-32 | idéntico |
| 20 | 4 | Tamaño comprimido | idéntico |
| 24 | 4 | Tamaño sin comprimir | idéntico |
| 28 | 2 | Longitud del nombre | bytes UTF-8 |
| 30 | 2 | Longitud del campo extra | `0` |
| 32 | 2 | Longitud del comentario | `0` |
| 34 | 2 | Número de disco inicial | `0` |
| 36 | 2 | Atributos internos | `0` |
| 38 | 4 | Atributos externos | `0` |
| 42 | 4 | Desplazamiento de la cabecera local | desde el inicio del archivo |
| 46 | L | Nombre | bytes UTF-8 |

### 10.4 Registro de fin del directorio central (22 bytes)

| Desplazamiento | Bytes | Campo | Valor escrito |
|---|---|---|---|
| 0 | 4 | Firma | `0x06054B50` |
| 4 | 2 | Número de este disco | `0` (no se escribe explícitamente; el búfer está a cero) |
| 6 | 2 | Disco del inicio del directorio | `0` (ídem) |
| 8 | 2 | Entradas en este disco | `N` |
| 10 | 2 | Entradas totales | `N` |
| 12 | 4 | Tamaño del directorio central | suma de bytes de todas las entradas del directorio |
| 16 | 4 | Desplazamiento del directorio central | bytes desde el inicio del archivo |
| 18 | 2 | Longitud del comentario | `0` |

### 10.5 CRC-32

| Parámetro | Valor |
|---|---|
| Polinomio | `0xEDB88320` (forma reflejada de `0x04C11DB7`), tabla precalculada de 256 entradas |
| Inicialización | `0xFFFFFFFF` |
| Recorrido | Para cada byte `b`: `c = tabla[(c XOR b) & 0xFF] XOR (c >>> 8)` |
| Finalización | `c XOR 0xFFFFFFFF`, interpretado como entero **sin signo** de 32 bits |
| Datos | Los bytes de la entrada **sin comprimir**, tal cual (con método 0 son los mismos bytes almacenados) |

### 10.6 Reglas del lector de referencia

1. Busca el EOCD recorriendo el archivo **hacia atrás** desde `tamaño − 22` hasta `tamaño − 66 000`, tomando el primer desplazamiento donde aparezca `0x06054B50`. Si no lo halla → `ZIP inválido (sin EOCD)`. **No** valida la longitud del comentario declarada.
2. Lee el número de entradas en el desplazamiento **EOCD+10** (entradas totales) y el inicio del directorio en **EOCD+16**.
3. Recorre las entradas del directorio central. Si la firma en la posición actual no es `0x02014B50`, **detiene el recorrido** sin error y devuelve lo leído hasta ahí.
4. Para cada entrada: lee método (`+10`), tamaño sin comprimir (`+24`), longitudes de nombre (`+28`), extra (`+30`) y comentario (`+32`), desplazamiento de la cabecera local (`+42`) y nombre (`+46`).
5. **Solo** procesa entradas con método `0`. Para ellas, lee de la cabecera local las longitudes de nombre (`+26`) y extra (`+28`), calcula el inicio de los datos como `local + 30 + Lnombre_local + Lextra_local` y toma `tamaño` bytes.
6. Devuelve `[{ name, bytes, text }]`, con `text` decodificado en UTF-8.
7. **No verifica el CRC-32.** Un lector conforme **DEBERÍA** verificarlo y **DEBERÍA** rechazar o marcar las entradas que no coincidan: es la única defensa contra corrupción de archivo, dado que los registros pueden no estar firmados.

---

## 11. Fusión de datos (merge)

### 11.1 El importador genérico

Entrada: un objeto `payload`. Antes de nada, el importador aplica **dos rechazos y una omisión obligatoria**:

| # | Comprobación | Comportamiento exacto |
|---|---|---|
| 1 | **Formato ajeno.** Si `payload.format` existe y **no** es `"pangea-exchange"` | **Se lanza un error y no se importa nada**: `Este archivo es un paquete «<format>»: ábrelo desde el módulo que lo generó`. El importador genérico **solo** acepta `pangea-exchange` (o un objeto sin `format`, que se trata como mapa de colecciones). Un `pangea-sos`, un `pangea-synapse`, un `pangea-passport`… **NO DEBEN** entrar por aquí: cada formato tiene su importador, que valida la firma de paquete y marca la procedencia. Colarlos por la vía genérica saltaría esas comprobaciones. |
| 2 | **La colección `identity`.** Si el payload trae filas en `identity`, se **omiten por completo** | La identidad **nunca** se importa desde un paquete de datos. Se marca `report.identitySkipped = true` y **no** se escribe ninguna fila (tampoco cuenta en `imported` ni en `skipped`). Aceptar una identidad por esta vía permitiría sustituir la identidad de alguien con solo enviarle un archivo: la identidad tiene su propio camino cifrado y con contraseña (§5). |
| 3 | **Payload vacío o no objeto** | Se lanza `Paquete inválido`. |

Después, la colección de origen se determina así: si `payload.collections` existe, se usa; si no, **el propio `payload` se trata como mapa de colecciones**. A continuación se recorren **únicamente** los nombres de colección conocidos; las claves desconocidas del payload se ignoran.

> **Consecuencia práctica (verificada y normativa).** Un archivo `pangea-sos` **NO PUEDE** importarse con el importador genérico, aunque tenga una clave `alerts` con un array: su `format` es `"pangea-sos"` y el importador lo **rechaza** (comprobación 1). Lo mismo vale para `pangea-synapse`, `pangea-lingua-dictionary`, `pangea-veritas-claim` o cualquier otro `format` declarado. Es una **mejora de seguridad consciente**, no una limitación: el camino genérico no aplica las normalizaciones de §9.3, ni marca la procedencia, ni verifica firmas, de modo que un paquete de formato ajeno que entrara por aquí lo haría **sin ninguna de las comprobaciones de su propio formato**. Una implementación conforme **DEBE** comportarse igual: resolver el importador por el campo `format` y **rechazar explícitamente** lo que no le corresponda.

### 11.2 La regla de conflicto (exacta)

Para cada registro `fila` del paquete y para cada colección conocida (**salvo `identity`**, que nunca se importa; §11.1):

| Paso | Regla |
|---|---|
| 1 | Si `fila` no es un objeto, o es `null`, o **no tiene `id`** → se descarta y se cuenta en `skipped`. **Un registro sin `id` nunca se importa.** |
| 2 | Se busca el registro local con el mismo `id` (solo si `merge = true`, que es el valor por omisión). |
| 3 | Si existe un registro local previo y su marca de tiempo es **mayor o igual** que la del entrante → se descarta y se cuenta en `skipped`. |
| 4 | En caso contrario (no hay previo, o el entrante es más nuevo) → el registro entra en el lote de escritura. |
| 5 | Contadores: si **no había** registro previo, `imported++`; si **sí había** (y el entrante es más nuevo, es decir, se sobrescribe), `skipped++`. |
| 6 | El lote se escribe con una operación de «poner» directa, **sin normalizar**: no se añade `createdAt` ni se reescribe `updatedAt`. Los valores entrantes se conservan tal cual. |

**La marca de tiempo de comparación** es `updatedAt` si existe, y si no `createdAt`, y si no `0`:

```text
marca(registro) = registro.updatedAt  ó  registro.createdAt  ó  0
```

**Informe adicional.** El objeto de informe que devuelve el importador incluye además `identitySkipped` (booleano, `true` cuando el payload traía filas en `identity` y se omitieron), junto con `imported`, `skipped` y `collections` (§11.3).

### 11.3 Los contadores que reporta el importador

```json
{
  "imported": 3,
  "skipped": 5,
  "identitySkipped": false,
  "collections": {
    "alerts": { "imported": 2, "skipped": 1 },
    "problems": { "imported": 1, "skipped": 4 }
  }
}
```

| Contador | Significado **exacto** |
|---|---|
| `imported` | Número de registros escritos que **no existían** localmente (ids nuevos). |
| `skipped` | Todo lo demás: filas sin `id`, filas descartadas por la regla «última escritura gana», **y también las filas que sí se escribieron sobrescribiendo una versión local anterior**. |
| `identitySkipped` | `true` cuando el payload traía al menos una fila en `identity` y se omitió la colección entera (§11.1). Esas filas **no** suman en `imported` ni en `skipped`. `false` en cualquier otro caso. |
| `collections[c]` | Solo aparece para colecciones que traían al menos una fila. **Nunca** aparece `identity`. |

> **Trampa de interpretación.** `imported + skipped` no es «lo que traía el archivo», y `skipped` **no** significa «ignorado»: incluye las sobrescrituras, que **sí** se aplicaron. Un importador conforme **DEBERÍA** informar por separado de `nuevos`, `actualizados` (sobrescrituras) y `descartados`, y **NO DEBE** presentar `skipped` como «no importado».

### 11.4 Consecuencias para dos nodos que divergen sin conexión

| Situación | Resultado |
|---|---|
| Un mismo `id` con versiones distintas (ediciones independientes) | Sobrevive la de `updatedAt` mayor. **No hay fusión de campos**: los cambios del perdedor se pierden por completo, aunque sean complementarios. |
| Un registro modificado en un nodo y no en el otro | El modificado gana, porque su `updatedAt` es mayor… **salvo** si la modificación no tocó `updatedAt`, cosa que no ocurre en la referencia, donde toda escritura lo reescribe. |
| Reimportación del mismo paquete | Idempotente: en la segunda pasada, `marca(local) >= marca(entrante)` para todos (el local conserva la marca, que ahora es mayor o igual), así que todo se cuenta en `skipped` y nada se reescribe. |
| Registro importado por primera vez | Al pasar por el camino genérico **se conserva** su `updatedAt` original; al pasar por el camino de SOS (`Store.put`) **se reescribe** a «ahora». Diferencia relevante: una alerta importada por la vía de SOS pasa a dominar cualquier versión futura que llegue con marcas antiguas, aunque su contenido sea más viejo. Una implementación conforme **DEBERÍA** conservar el `updatedAt` de origen al importar alertas. |
| Empate exacto de marcas | Gana el local (`>=` descarta al entrante). El resultado es **determinista** entre dos nodos que importan en el mismo orden, pero **puede diferir** entre dos nodos que importan en orden distinto si los contenidos difieren con la misma marca. Para convergencia garantizada, los productores **DEBERÍAN** garantizar marcas estrictamente crecientes por registro. |
| Relojes desincronizados | No hay Lamport ni vector de versiones: la convergencia depende del reloj de pared. Un nodo con el reloj adelantado gana siempre. Es una limitación conocida y asumida del formato 1.0. |
| Borrados | **Los borrados no se propagan.** Un registro borrado en un nodo reaparece al importar un paquete que lo contenga. No hay lápidas ni campo `deleted`. |
| Confianza en las marcas | `updatedAt` y `createdAt` **no están firmados** (están en `NOT_SIGNED`, §3.3). Cualquiera puede alterarlos para forzar que su versión gane. La regla de fusión es de **orden**, no de **autenticidad**: la verificación de firma se hace (o no) aparte. |

---

## 12. Transporte sin red

### 12.1 El modelo del portador

```text
   NODO A                    PORTADOR (sin red)                    NODO B
   ──────                    ──────────────────                    ──────
  1. produce registros firmados en local
  2. exporta un PAQUETE  ──▶  3. archivo .json / .zip / .pangea
                               USB · Bluetooth · radio · SMS · QR
                               papel · disco · persona que camina
                                                          ──▶  4. valida el formato
                                                              5. verifica la firma del paquete
                                                              6. verifica la firma de cada registro
                                                              7. deduplica por id
                                                              8. marca la procedencia
                                                              9. almacena lo no verificable como NO VERIFICABLE
```

Propiedades del modelo, todas ellas derivadas del diseño y **normativas**:

| Propiedad | Enunciado |
|---|---|
| Sin sesión | No hay acuerdo previo, ni claves compartidas, ni servidor de descubrimiento. La clave pública viaja **dentro** del sobre. |
| Sin orden | Los paquetes **PUEDEN** llegar en cualquier orden, repetidos, o nunca. La importación **DEBE** ser idempotente respecto de los `id`. |
| Sin acuse | La importación **NO DEBE** requerir confirmación del emisor. |
| Asimétrico | El receptor **DEBE** poder importar incluso si no puede exportar (nivel Lector, §14). |
| Un paquete, muchos canales | El mismo archivo **DEBE** poder viajar por cualquier canal. Por eso el contenido firmado es texto JSON compacto (un SMS de un solo registro, un QR de un paquete firmado) y por eso el ZIP **no** comprime (§10: la compresión no es necesaria y añade complejidad). |
| Presupuesto de tamaño | El protocolo **NO** impone límites, pero un paquete SOS pequeño cabe en un QR. Los adjuntos de MEMORIA (`dataUrl` Base64) y los audios de LINGUA son los casos que rompen cualquier canal estrecho; una implementación **DEBERÍA** ofrecer exportación **sin adjuntos** para canales de bajo ancho de banda. |

### 12.2 Lo que una implementación **DEBE** rechazar

Un rechazo **DEBE** ser explícito, con un mensaje distinguible, y **NO DEBE** dejar datos a medias: o no se importa nada del paquete, o se importa **todo lo aceptable** y se informa de cada descarte.

| # | Condición | Requisito |
|---|---|---|
| R1 | El texto no es JSON válido | **DEBE** rechazarse el archivo completo. |
| R2 | El objeto de nivel superior no es un objeto (es array, número, cadena, `null`) | **DEBE** rechazarse. |
| R3 | El campo `format` no es el esperado por el importador que se está usando (p. ej. se alimenta un `pangea-sos` al importador de MEMORIA, o llega un `format` desconocido) | **DEBE** rechazarse. Para el caso de SOS, la comprobación es literal: `format === "pangea-sos"` **y** `alerts` debe ser un array. |
| R3b | Un paquete con `format` declarado alimentado al **importador genérico** de `pangea-exchange` | **DEBE** rechazarse el archivo completo si `format ≠ "pangea-exchange"`, con un mensaje que nombre el formato recibido e indique desde qué módulo debe abrirse (§11.1). Un paquete **sin** `format` **PUEDE** tratarse como mapa de colecciones. Esta regla es la que impide que un `pangea-sos` o un `pangea-synapse` entren por la vía genérica, donde no se validaría su firma ni se marcaría la procedencia. |
| R4 | Un paquete ZIP que no contiene la entrada obligatoria de su formato (`data.json` para `pangea-passport`, `knowledge.json`/`curations.json` según lo que declare el manifiesto para `pangea-memoria`) | **DEBE** rechazarse (o importarse lo presente y declararse **incompleto**; ver la nota de divergencia). |
| R5 | Base64 inválido o firma con longitud distinta de 64 bytes | La firma **DEBE** considerarse inválida; el registro **NO DEBE** presentarse como verificado. |
| R6 | Firma que no valida sobre la proyección canónica | El registro **DEBE** marcarse como **no verificado** y **NO DEBE** presentarse nunca como verificado, aunque se almacene. Ver la nota de divergencia. |
| R7 | Un registro sin `id` (campos `id` ausente, vacío o no cadena) | **DEBE** descartarse el registro (no puede deduplicarse ni fusionarse). |
| R8 | Un registro con `pub` ilegible o con curva distinta de P-256 | **DEBE** tratarse como no verificable. |
| R9 | Un `sig.fp` que no coincide con la huella recalculada de `pub` | **DEBE** tratarse como **no verificable** (código `huella_discrepante`, §4.4 paso 6, §4.5) y **DEBERÍA** informarse como posible suplantación. La implementación de referencia ya lo hace: `Crypto.verify` devuelve falso. Un `origin.fingerprint` o `importedFrom` que no coincida con la huella recalculada es un metadato (no cubierto por firma) y **NO DEBE** usarse nunca como identidad (§12.4 paso 4). |
| R10 | Un paquete de datos que traiga filas en la colección `identity` | **DEBE** rechazarse la importación de esa colección (`report.identitySkipped = true`) y **NO DEBE** escribirse ninguna fila de identidad. La identidad solo se acepta por el sobre cifrado `PANGEA-ID-1` (§5, §11.1, §15.7). |

> **Nota de divergencia (honestidad sobre el código).** La implementación de referencia **no cumple** R6 en su forma estricta: `js/modules/sos.js` calcula la validez del paquete, la muestra como aviso, y **importa los registros igualmente**, contando cuántas firmas individuales verificaron pero sin excluir ninguna. Del mismo modo, MEMORIA muestra el veredicto del manifiesto sin bloquear la importación, y el camino de SOS trata un paquete **sin** `sig` como aceptable (paquete no firmado, no inválido). Esto es coherente con el principio «una alerta útil es una alerta que llega» —en una emergencia, descartar datos por una firma que no verifica puede matar a alguien—, pero **obliga a la interfaz a no presentar como verificado lo que no lo es**. Una implementación conforme **DEBE** elegir una de estas dos políticas y declararla: (a) **estricta**: rechazar los registros cuya firma no verifica; (b) **permisiva**: importarlos **marcados como no verificados**, con la procedencia del paquete visible y el recuento de firmas válidas. Lo que **NO DEBE** hacerse en ningún caso es importar en silencio y mostrar el contenido como auténtico.

### 12.3 Lo que una implementación **PUEDE** aceptar con advertencia

| # | Condición | Requisito | Comportamiento de la referencia |
|---|---|---|---|
| A1 | Paquete sin firma (`sig` ausente) | **PUEDE** aceptarse. **DEBERÍA** informarse «paquete no firmado». Los registros internos firmados siguen siendo verificables uno a uno. | Acepta. Muestra la firma como no verificable y sigue. |
| A2 | Registro con firma no verificable | **PUEDE** almacenarse, siempre que quede **marcado** como no verificado y que la interfaz no lo muestre como auténtico. | Almacena y muestra un sello de firma inválida. |
| A3 | Registrar con `pub`/`alg` desconocidos (`alg` distinto de `ECDSA-P256-SHA256`) | **PUEDE** almacenarse. La verificación **DEBE** basarse en el algoritmo real, no en la etiqueta. | Ignora `alg`. |
| A4 | Colección desconocida en un `pangea-exchange` | **DEBE** ignorarse en silencio, sin error. **NO DEBE** provocar el rechazo del paquete. Un nodo conforme **DEBERÍA** conservarla para reenviarla (§13). | `importAll` recorre solo los nombres conocidos: las claves desconocidas se ignoran y no se conservan. |
| A5 | `category` fuera de los 14 identificadores | **PUEDE** aceptarse. **DEBERÍA** advertirse. **NO DEBE** reescribirse ni mapearse silenciosamente: alterar `category` invalida la firma. | Acepta y muestra el identificador crudo. |
| A6 | Valores de enumeración desconocidos (tipo de alerta, severidad, recurso, tipo de saber, licencia, valor de voto) | **PUEDE** aceptarse. **DEBERÍA** aplicarse un valor por omisión **documentado**, y solo en campos **no firmados** o en campos que la firma ya excluye; si el campo **sí** está firmado (`type`, `severity`, `value`, `kind`, `license`), normalizarlo **rompe la verificación**, así que una implementación conforme **DEBERÍA** conservar el valor original y mostrarlo como desconocido. | SOS **sí** normaliza `type` y `severity` al importar (a `other` y `medium`), lo que invalida la firma del registro importado si el valor original era distinto. Es una divergencia: ver el Apéndice D. |
| A7 | Campos desconocidos dentro de un registro | **DEBE** conservarse y reenviarse (§13). | SOS y `importAll` conservan los campos desconocidos del registro (copia + sobrescritura de campos conocidos). |
| A8 | Campos desconocidos en la raíz de un paquete | **PUEDE** descartarse. | Se descartan. |
| A9 | Un registro más nuevo local que el entrante | **DEBE** conservarse el local (regla de fusión, §11). | Aplica `>=` y descarta el entrante. |
| A10 | Paquete enorme o con adjuntos | **PUEDE** rechazarse por límites de recursos, con un mensaje claro. | Sin límites explícitos. |

### 12.4 La importación, paso a paso (normativa)

1. **Leer bytes y decodificar UTF-8.** Si el contenedor es ZIP, abrir el ZIP (§10) y extraer las entradas por nombre.
2. **Parsear JSON.** Fallo → rechazo (R1).
3. **Comprobar el contenedor y resolver el importador por el `format` declarado.** Objeto de nivel superior (R2) y `format` esperado por el importador que se va a usar (R3). Si el camino es el **genérico** de `pangea-exchange` y el `format` existe y **no** es `pangea-exchange` → **rechazo inmediato** (R3b), sin importar nada. Es un **DEBE**: un paquete de formato ajeno no entra por la vía genérica.
4. **Excluir la colección `identity`.** Ninguna ruta de importación de paquetes de datos escribe filas de identidad (R10). Si el payload traía alguna, se omiten y se marca `identitySkipped`. La identidad se recupera **solo** descifrando un `PANGEA-ID-1` (§5).
5. **Determinar el sujeto de la firma del paquete.** Si existe `sig` a nivel de paquete:
   a. verificar la firma con §4.4 sobre el objeto de paquete completo —lo que incluye la comprobación de huella `sig.fp` contra `fingerprintOf(sig.pub)`;
   b. calcular `fp_paquete ← fingerprintOf(sig.pub)` (§4.2) y **no** fiarse de `sig.fp` ni de `origin.fingerprint` (§4.5).
6. **Iterar los registros** de la colección o colecciones del paquete.
7. **Descartar** los registros sin `id` válido (R7) y los ya existentes con marca mayor o igual (§11.2).
8. **Verificar la firma de cada registro ANTES de tocarlo**: cualquier anotación local que se añada después (`origin`, `importedFrom`, `updatedAt`) no debe contaminar la proyección. Verificar contra el registro **tal como viajó**.
9. **Marcar la procedencia**: `origin` = `"imported"`, `importedFrom` = huella del paquete (o del registro). Es información **informativa**, no autenticada por sí misma: la huella debe haberse recalculado en el paso 5.
10. **Marcar el estado de verificación** de cada registro de forma que la interfaz pueda distinguir «firmado y verificado» de «firmado pero no verifica», de «huella declarada discrepante» y de «sin firma». **No** confundir «no verificado» con «falso».
11. **Escribir** de forma idempotente y reportar los contadores (§11.3), incluido `identitySkipped`.
12. **Devolver un informe** con: formato detectado, resultado de la firma del paquete, huella del emisor (recalculada), registros nuevos, registros actualizados, registros descartados, registros sin firma, registros con firma inválida, registros con huella discrepante y si se omitió alguna identidad.

---

## 13. Versionado y extensibilidad

### 13.1 El campo `spec`

Todo paquete de intercambio lleva `spec: "1.0"`. Reglas normativas:

| Regla | Enunciado |
|---|---|
| N1 | El campo `spec` **DEBE** estar presente en todo paquete que este documento define, con el valor `"1.0"`. |
| N2 | Un lector **DEBE** aceptar un paquete con `spec` de la misma **versión mayor** (es decir, `1.x`) tratándolo como compatible. |
| N3 | Un lector que no soporte la versión mayor encontrada **NO DEBE** importar los datos a ciegas: **DEBE** rechazar el paquete con un mensaje que indique la versión requerida. |
| N4 | `spec` es un campo **firmado** cuando el paquete se firma (no está en la lista de exclusión de §3.3). Cambiarlo rompe la firma. |

### 13.2 Compatibilidad hacia adelante: preservar y reenviar

> **REQUISITO.** Una implementación conforme **DEBE** conservar los campos que no reconoce dentro de los **registros** y **DEBE** reenviarlos intactos cuando vuelva a exportar. **NO DEBE** descartarlos, normalizarlos, renombrarlos ni reordenarlos. Un campo desconocido **NO DEBE** impedir la verificación de la firma ni la importación del registro.

Justificación: el protocolo está pensado para que un nodo antiguo pueda transportar datos de un nodo nuevo sin entenderlos. Ese es el mecanismo por el que una versión 1.1 puede introducir un campo nuevo y seguir viajando por una red de nodos 1.0. La firma sigue siendo válida porque el campo desconocido **estaba presente al firmar** y la proyección canónica lo incluye (solo se excluyen los 20 nombres listados en §3.3).

Aplicación concreta:

| Elemento | Requisito |
|---|---|
| Campos desconocidos de un registro | **DEBEN** conservarse y reenviarse. |
| Colecciones desconocidas en un `pangea-exchange` | **DEBERÍAN** conservarse y reenviarse (la referencia las descarta al importar: ver Apéndice D). |
| Claves desconocidas en la raíz de un paquete | **PUEDEN** descartarse, pero **NO DEBEN** provocar un rechazo. |
| Valores desconocidos en enumeraciones | **DEBEN** conservarse tal cual (alterarlos rompe la firma). |

### 13.3 Cómo debe negociarse una futura 2.0

Propuesta normativa (la 2.0 no existe todavía en el código; esto es un procedimiento, no una descripción):

1. **Nueva versión mayor solo si hay cambio incompatible.** Añadir campos opcionales, colecciones nuevas o valores nuevos de enumeración **NO** justifica una versión mayor: son cambios compatibles dentro de `1.x`.
2. **Un nodo 2.0 DEBE seguir produciendo y aceptando 1.x** mientras negocie con nodos 1.x. La detección es por el propio campo `spec` del paquete, sin negociación previa.
3. **La negociación es por paquete, no por sesión.** No existe handshake. Un nodo 2.0 que recibe `spec: "1.0"` **DEBE** responder y emitir en 1.0.
4. **Los cambios incompatibles candidatos para 2.0** (los tres puntos débiles conocidos de 1.0, que una 2.0 debería resolver): (a) `spec` a nivel de **registro**, no solo de paquete; (b) firma del **conjunto de campos de ciclo de vida** (`status`, `createdAt`, `id`) mediante un segundo sobre o un recibo firmado, para distinguir «el autor firmó este contenido» de «alguien cambió el estado»; (c) **lápidas** para propagar borrados.
5. **Prohibición de ambigüedad.** Un paquete **NO DEBE** contener dos versiones mezcladas. Si un nodo necesita transportar registros de dos generaciones, **DEBE** emitir dos paquetes.

### 13.4 Identificadores reservados

Los nombres de campo de la lista de exclusión (§3.3) están **reservados**, y lo están **en cualquier nivel**. Una implementación **NO DEBE** usarlos con un significado distinto dentro del contenido firmado: cualquier campo llamado `sig`, `signature`, `updatedAt`, `_vec`, `_score`, `local`, `id`, `createdAt`, `status`, `confirmations`, `origin`, `importedFrom`, `collaborators`, `seed`, `score`, `explain`, `matchedAt`, `seenBy`, `curationAvg` o `curationCount` —**esté en la raíz, dentro de un objeto anidado o dentro de un objeto de un array**— desaparecerá de la proyección y **no estará protegido por la firma**. Si una implementación necesita un campo propio con ese nombre semántico, **DEBE** renombrarlo.

---

## 14. Conformidad (niveles)

### 14.1 Definición de los tres niveles

| Nivel | Nombre | Capacidad | Caso de uso |
|---|---|---|---|
| **L1** | **Nodo Lector** | Lee, verifica y muestra. No produce firmas. | Un tablero público, un analista de datos, un archivo histórico, una radio que solo difunde. |
| **L2** | **Nodo Firmante** | Todo L1, más: genera identidad, firma registros y paquetes, exporta e importa identidad portátil, emite atestaciones. | Una aplicación móvil que publica, un servicio web que emite certificados de contribución. |
| **L3** | **Nodo Completo** | Todo L2, más: produce y consume los cinco formatos de paquete, escribe y lee el ZIP propio, fusiona datos con la regla de conflicto y reporta resultados. | Un nodo comunitario, un servidor de barrio, un script de sincronización por USB. |

Un nodo **DEBE** declarar en qué nivel es conforme y **NO DEBE** declarar un nivel que no supere íntegramente su lista de comprobación.

### 14.2 Nivel 1 — Nodo Lector

Pruebas observables. Todas **DEBEN** superarse para declarar L1.

| # | Prueba (conducta observable) |
|---|---|
| L1.1 | Dado el `pangea-exchange` del Apéndice A y el paquete `pangea-sos` de §9.3, el nodo lista los registros de las 12 colecciones de contenido e informa de un recuento por colección que coincide con `counts`. |
| L1.2 | Dado el registro firmado del Apéndice A y su sobre, el nodo **acepta** la firma; y dada la misma firma sobre un registro con la misma `title` pero distinto cuerpo, el nodo **rechaza** la firma. |
| L1.3 | Dado el `pub` del Apéndice A y **nada más**, el nodo produce exactamente la huella `PAN-ML72-N5P6-UFPK`. |
| L1.4 | Dado el mismo registro con un byte alterado en `body`, `title`, `category`, `urgency`, `tags[0]`, `location.lat` o `author.fingerprint`, el nodo **rechaza** la firma en los siete casos. |
| L1.5 | Dado el mismo registro con `id`, `createdAt`, `updatedAt`, `status` o `sig` alterados, el nodo **sigue aceptando** la firma (porque esos campos no están firmados), y **no** informa de que el contenido cambió. |
| L1.6 | Dado el `pangea-sos` de §9.3, el nodo verifica **con éxito las dos firmas** por separado: la del paquete contra `canonical(paquete)` y la de cada alerta contra `canonical(alerta)` calculada de forma aislada. **Prueba obligatoria de proyección única:** la proyección de cada alerta anidada coincide **byte a byte** con la que produce el mismo registro suelto, y aparece **literalmente como subcadena** de `canonical(paquete)` (§3.4). En consecuencia, alterar `id`, `createdAt`, `status`, `origin`, `importedFrom` o `confirmations` de una alerta anidada **no** cambia `canonical(paquete)` y **no** rompe la firma del paquete. Un nodo que aplique una exclusión distinta según el nivel no es conforme. |
| L1.7 | Dado un texto que no es JSON, el nodo informa de un error distinguible y **no** modifica su almacén. |
| L1.8 | Dado un paquete con `format: "algo.desconocido"`, el nodo informa de un error distinguible y **no** importa nada. |
| L1.9 | Un registro sin `sig` se muestra como **no verificable**, nunca como verificado ni como falso. |
| L1.10 | Un registro cuyo `sig.fp` no coincide con la huella recalculada de `sig.pub` se considera **no verificable** (requisito §4.5), y el nodo **no** muestra la huella declarada: muestra la recalculada o marca explícitamente la suplantación. |
| L1.11 | **Idempotencia de la proyección:** proyectar dos veces el mismo objeto (aplicar `CANONICAL` a su propia salida estructurada) produce exactamente la misma cadena que proyectarlo una vez, para un objeto con claves desordenadas, campos excluidos en la raíz y campos excluidos anidados (§3.4). |

### 14.3 Nivel 2 — Nodo Firmante

Todo L1, más:

| # | Prueba (conducta observable) |
|---|---|
| L2.1 | El nodo genera un par P-256, exporta la clave pública como cadena JWK y **conserva esa cadena verbatim** al almacenarla y al retransmitirla. |
| L2.2 | El nodo produce un sobre con exactamente los campos `sig`, `pub`, `fp`, `alg`, `at`, con `sig` de **64 bytes** en Base64 (88 caracteres terminados en `==`). |
| L2.3 | **Interoperabilidad cruzada:** un registro firmado por el nodo candidato **verifica** con la implementación de referencia, y un registro firmado por la referencia **verifica** con el candidato. Se prueban ambos sentidos con el mismo registro. |
| L2.4 | El nodo **no** produce firmas en formato DER. Si se le entrega una firma DER, la rechaza (longitud ≠ 64). |
| L2.5 | El nodo implementa la proyección canónica: dado un objeto con las claves desordenadas y con un campo `sig` anidado, produce exactamente la misma cadena que el vector del Apéndice A. |
| L2.6 | El nodo **no** incluye `id`, `createdAt`, `status`, `origin`, `importedFrom`, `confirmations`, `collaborators`, `seed`, `score` ni `explain` en la proyección **en ningún nivel**, tampoco cuando esos campos están **anidados** dentro de un paquete que se firma: la proyección del registro anidado es idéntica a la del registro suelto (§3.3, §3.4). |
| L2.7 | Exportar la identidad con contraseña de 7 caracteres **falla**; con 8 o más produce un sobre `PANGEA-ID-1` con `salt` de 16 bytes y `iv` de 12 bytes (decodificados). |
| L2.8 | Importar ese sobre con contraseña **incorrecta** falla con un error único y distinguible; con la **correcta** recupera un registro cuya huella coincide con la original y cuya clave privada produce firmas que la referencia verifica. |
| L2.9 | El nodo emite una atestación `pangea.attestation` con `kind`, `from`, `to`, `points`, `reason`, `context`, `issuedAt`, `nonce` y `sig`; la referencia la considera `válida`. |
| L2.10 | Dada una atestación con `to` o `points` alterados, el nodo la considera `no verificable`. Dadas **dos** suplantaciones distintas del emisor declarado, el nodo las distingue: (a) atestación re-firmada por otra clave que **conserva** `from` y `sig.fp` del emisor original ⇒ `no verificable` (la huella declarada ya no corresponde a la clave que firmó, §4.4 paso 6); (b) atestación re-firmada por otra clave con `sig.fp` coherente con **su** clave pero `from` del emisor original ⇒ veredicto **`firma válida, emisor no coincide`**, y el nodo **no** suma esos puntos al emisor declarado (§6.3 pasos 3–5). |

### 14.4 Nivel 3 — Nodo Completo

Todo L2, más:

| # | Prueba (conducta observable) |
|---|---|
| L3.1 | El nodo escribe un ZIP que un lector ZIP estándar abre sin avisos de CRC, con método 0, flag `0x0800`, y puede leer un ZIP escrito por la implementación de referencia. |
| L3.2 | Ida y vuelta de `pangea-passport`: exportar, reimportar con el mismo nodo y con la referencia, y obtener **el mismo contenido firmado** (mismas proyecciones canónicas por registro) y el mismo resultado de verificación del manifiesto. Además, el `data.json` exportado **NO DEBE** contener la clave privada: `collections.identity` vacía, `counts.identity` = 0, `omitted` incluye `"identity"` y `collections.settings` sin `pref.llm.key` ni `pref.translate.endpoint.token`. |
| L3.3 | Ida y vuelta de `pangea-sos`: el paquete exportado se importa con la referencia y viceversa; en ambos sentidos cada alerta verifica con su propia firma **antes** de que el receptor añada `origin`/`importedFrom`. |
| L3.4 | Ida y vuelta de `pangea-memoria`: el manifiesto se verifica reconstruyendo exactamente los cuatro campos `{format, spec, exportedAt, counts}` y usando `signature` o `sig` como sobre. |
| L3.5 | El nodo importa un `pangea-lingua-dictionary` y verifica cada palabra con su firma individual, sin esperar firma de paquete. |
| L3.6 | **Fusión:** partiendo de dos almacenes que comparten un `id` con contenidos distintos, tras el intercambio cruzado de paquetes ambos nodos contienen el registro con `updatedAt` mayor, y ninguno de los dos contiene dos copias de ese `id`. |
| L3.7 | **Contadores:** al importar un paquete que trae 2 ids nuevos, 1 sobrescritura y 1 fila sin `id`, el nodo reporta `imported = 2` y **nuevos/actualizados/descartados** separados (o `skipped = 2` si reproduce literalmente la referencia). En ningún caso presenta la sobrescritura como no importada. |
| L3.8 | **Sin `id` no hay importación:** un registro sin `id` **nunca** se escribe. |
| L3.9 | **Idempotencia:** importar dos veces el mismo paquete deja el almacén idéntico tras la segunda pasada. |
| L3.10 | **Preservación:** un registro con un campo desconocido `mi_campo_extra` se importa, se almacena y se reexporta con ese campo intacto, y la firma sigue verificando. |
| L3.11 | **Deduplicación SOS:** un paquete SOS con un `id` ya presente **no** sobrescribe el registro local; el contador de descartes lo refleja. |
| L3.12 | **Rechazo por formato:** alimentar el importador de MEMORIA con un `pangea-sos`, y el de SOS con un `pangea-memoria`, produce rechazo explícito en ambos casos. Y alimentar el **importador genérico** (§11.1) con un `pangea-sos`, un `pangea-synapse` o un `pangea-passport` produce rechazo explícito, con un mensaje que **nombra el formato recibido** y **no** importa ninguna fila. Un paquete **sin** `format` **sí** puede tratarse como mapa de colecciones. |
| L3.13 | **Procedencia verificable:** tras importar un `pangea-sos`, la procedencia que muestra el nodo se basa en la huella **recalculada** de `sig.pub`, no en `origin.fingerprint` ni en `sig.fp`. Para probarlo: entregar un paquete con `origin.fingerprint` y `sig.fp` de la víctima pero firmado con otra clave ⇒ el nodo **DEBE** mostrar la huella del firmante real y **NO DEBE** presentar el paquete como verificado (con la referencia, `Crypto.verify` devuelve falso y `signerOf().spoofed` es `true`). |
| L3.14 | **Secretos y procedencia de identidad:** con `pref.llm.key` y `pref.translate.endpoint.token` configurados, exportar un `pangea-exchange` produce un archivo cuya `collections.settings` **no** contiene esas claves, cuyo `counts.identity` es `0`, cuya `collections.identity` está vacía y cuyo `omitted` incluye `"identity"`; y alimentar el importador con un payload que traiga filas en `identity` **no** escribe ninguna fila y reporta `identitySkipped = true` (§11.1, §15.7). |

### 14.5 Declaración de conformidad (plantilla)

```text
Implementación: <nombre y versión>
Lenguaje/plataforma: <...>
Nivel declarado: L1 | L2 | L3
Resultado de las pruebas: <lista Lx.y con APTO/NO APTO>
Divergencias declaradas: <lista, con justificación>
Política de firma inválida: estricta | permisiva (con marcado obligatorio)
Fecha: <...>
```

---

## 15. Consideraciones de seguridad y privacidad

### 15.1 Qué prueba la firma y qué no

**Prueba** (con `verify` en verdadero):

1. Que quien posee la clave privada correspondiente a `sig.pub` firmó la proyección canónica **exacta** de ese objeto.
2. Que el contenido firmado no cambió desde entonces: un solo byte distinto en cualquier campo de la proyección invalida la firma.
3. Que la huella declarada `sig.fp`, **si existe**, es la huella de `sig.pub`: es decir, que quien firmó es también quien declaró ser (§4.5).

**No prueba tampoco** (dentro del propio sobre): ni `at` ni ningún otro campo del sobre están cubiertos por la firma, porque la lista de exclusión `NOT_SIGNED` (§3.3) elimina `sig` (y `signature`) de la proyección en todos los niveles. `at` es una **declaración informativa** del firmante sobre cuándo firmó: no está autenticada por separado y un tercero puede alterarla sin invalidar la firma. Lo único que sí queda anclado al contenido firmado es lo que el autor decidió incluir **dentro** del objeto (por ejemplo, `issuedAt` en una atestación, o `at` en un voto, que son campos del registro y no del sobre).

**No prueba:**

| Lo que la firma NO prueba | Detalle |
|---|---|
| Que el contenido sea **verdadero** | Solo que alguien lo afirmó. Un saber falso firmado es un saber falso verificado. |
| Que el firmante actúe de **buena fe** | El spam firmado sigue siendo spam. |
| Quién es el firmante **en la vida real** | Prueba el control de una clave. El vínculo clave-persona es social, no criptográfico. |
| Que **otros campos** no hayan cambiado | Los 20 campos de §3.3 **no están firmados en ningún nivel**: ni en la raíz de un registro, ni dentro de un objeto anidado, ni dentro de un objeto de un array. Cambiar `id`, `createdAt`, `updatedAt`, `status`, `confirmations`, `origin`, `importedFrom`, `collaborators`, `seed`, `score` o `explain` de un registro firmado **no rompe su firma**, viaje suelto o anidado dentro de un paquete (§3.4). Ejemplo concreto y real: cualquiera puede tomar una alerta firmada y poner `status: "atendida"` sin invalidar la firma del autor, y puede hacerlo también con la alerta copiada dentro de un `pangea-sos`. |
| La unicidad del autor | Nada impide generar claves nuevas ilimitadamente (Sybil). |
| Que el registro haya sido **emitido** una sola vez | Replay libre (§15.3). |

> **Consecuencia de diseño (normativa).** Una implementación **NO DEBE** presentar un registro como «auténtico» en su totalidad. **DEBE** distinguir en la interfaz entre **contenido firmado y verificado** y **campos de estado no firmados**. La implementación de referencia lo hace parcialmente: muestra un sello de firma por registro, y admite que la interfaz cambie `status` sin re-firmar cuando quien muta no es el autor (y **sí** re-firma cuando quien muta es el autor: `patchAlert` vuelve a sellar el registro completo si el firmante es el autor).

### 15.2 Suplantación de huella: cerrada en el verificador

**El ataque.** La huella `fp` del sobre es texto libre: no está cubierta por ninguna firma, porque el sobre entero vive bajo la clave `sig`, que la proyección excluye (§3.3). Sin defensa, un atacante podría:

1. generar su propio par de claves;
2. firmar un contenido con su clave privada;
3. escribir en `fp` —y en `origin.fingerprint`, y en `author.fingerprint` si ese campo no estuviera firmado en el contexto— la huella de su víctima;
4. entregar el paquete.

La verificación de firma pasaría (la firma es válida respecto de **su** clave pública) y un verificador descuidado mostraría la huella de la víctima como autora.

**Estado actual: rechazado por el verificador.** La implementación de referencia ya **no** cae en el ataque: `Crypto.verify()` compara `sig.fp`, cuando existe, con `fingerprintOf(sig.pub)` y devuelve **falso** si no coinciden (§4.5). Además, `signerOf()` **siempre recalcula** la huella desde `sig.pub` —nunca devuelve `fp` como identidad— y expone `claimed` (lo declarado) y `spoofed: true` cuando la declaración no corresponde a la clave.

**Mitigación obligatoria (normativa):**

1. Recalcular **siempre** la huella desde `pub` (§4.2) y usarla como identidad del firmante.
2. Comparar la huella recalculada con **todos** los campos de huella declarados: `sig.fp`, `origin.fingerprint`, `importedFrom` y cualquier otro metadato de autoría. Si `sig.fp` discrepa, el registro es **no verificable** (`huella_discrepante`, §4.4).
3. **No** mostrar nunca una huella que la propia implementación no haya derivado de la clave pública que validó.

Nótese que `author` **sí** está dentro del contenido firmado de un registro publicado con identidad: suplantar `author.fingerprint` en ese caso **rompe la firma**. Los campos que siguen siendo libres —no cubiertos por firma alguna— son los de fuera del contenido firmado: `sig.fp` (redundante y ahora comprobado), `origin.fingerprint`, `importedFrom` y cualquier huella que el nodo receptor se invente sin recalcular. El ataque queda **cerrado en el verificador**, pero la lección de diseño permanece: una huella declarada es siempre un dato derivado y nunca una identidad.

> **Nota honesta sobre `sig.fp`.** El campo sigue siendo **redundante** y **no autoritativo**: no aporta información que no esté ya en `pub`, y por sí solo no autentica nada. Su único valor es de comodidad (mostrar la huella sin recalcular) y de **detección**: si discrepa de `pub`, es prueba de manipulación del sobre. Una implementación conforme **PUEDE** omitirlo al firmar —la verificación sigue siendo completa— y **NO DEBE** confiar en él al verificar.

### 15.3 Replay y blanqueo de procedencia

| Ataque | Cómo funciona | Defensa recomendada (y su límite) |
|---|---|---|
| **Replay** | Reenviar un paquete o un registro válido cuantas veces se quiera. La firma no caduca y no está ligada a un destinatario ni a un contador. | Deduplicar por `id`. Límite: un atacante puede cambiar el `id` (§15.1) y producir «copias nuevas» del mismo contenido firmado. Deduplicar además por huella del contenido firmado (la proyección canónica) es la única defensa razonable. |
| **Blanqueo de procedencia** *(provenance laundering)* | Tomar contenido firmado por A, reempaquetarlo como propio y presentarlo como propio ante un tercero que no tiene el paquete original. El paquete nuevo lleva la firma de B en la raíz; los registros internos conservan las firmas de A. | El tercero **DEBE** verificar y mostrar la firma de **cada registro**, no solo la del paquete. La firma del paquete acredita **quién transporta**, no **quién es autor**. Un nodo conforme **DEBE** mostrar autoría por registro. |
| **Reetiquetado de estado** | Cambiar `status`, `confirmations` o `origin` sin romper la firma. | Mostrar esos campos como **no firmados**. Un nodo **NO DEBE** permitir que un campo no firmado altere decisiones críticas (p. ej. cerrar una alerta) sin atribuir explícitamente ese cambio a quien lo hizo localmente. |
| **Suplantación de procedencia en SOS** | `origin.fingerprint` es libre (está en `NOT_SIGNED`, §3.3, y en el paquete SOS es una clave de raíz). | Usar la huella recalculada de `sig.pub` (§12.4 paso 5). |
| **Borrado y resurrección** | Un registro borrado reaparece al importar un paquete antiguo. | No hay lápidas en 1.0. **DEBE** documentarse; una 2.0 debería añadirlas (§13.3). |
| **Envenenamiento por reloj** | Un `updatedAt` futuro hace que una versión gane siempre. | El `updatedAt` no está firmado y la fusión es de orden. Un nodo **DEBERÍA** advertir de marcas futuras y **PUEDE** acotarlas. |

### 15.4 Unicidad de identidad y Sybil

El protocolo **no** resuelve el ataque Sybil, y **no debe** fingir que lo hace. Sus únicas defensas son de **costo social observable**:

- La reputación se agrega por **huella emisora distinta**: un nodo que suma puntos **DEBE** poder decir cuántos emisores distintos los otorgaron. Cien atestaciones de una sola huella valen lo que valga esa huella.
- El `nonce` permite a un agregador detectar duplicados exactos y autoatestaciones repetidas.
- El detector de anomalías de VERITAS (ráfagas de 90 s, fuego rápido de 20 s, diversidad de evidencia) es una herramienta **local y auditable** que un tercero **PUEDE** reproducir a partir de los datos firmados (`pangea-veritas-claim` incluye `weights`, `consensus`, `anomaly` y `credibility` precisamente para eso).

### 15.5 Lo que revela inevitablemente un paquete transportado sin conexión

Un paquete PANGEA **no es anónimo**, y decirlo con precisión importa:

| Metadato | Qué revela |
|---|---|
| Huella del firmante | Un seudónimo **estable**: todos los registros firmados por la misma clave son enlazables entre sí, aunque viajen en paquetes distintos, por canales distintos y en años distintos. |
| Clave pública | Permite comprobar la reutilización de la misma clave en cualquier otro contexto donde aparezca. |
| Nombre en `author.name` | Si el usuario lo rellenó, **es texto libre en claro** dentro del contenido firmado. |
| Geolocalización | `location.lat`/`lng` en problemas, capacidades y alertas. En una alerta médica, esto puede identificar a una persona. |
| Horas | `createdAt`, `at`, `issuedAt`, `at` de la firma. Con suficientes registros, reconstruyen un patrón de vida. |
| Idioma | `lang`, `contentLang`, `dialect` pueden acotar mucho la comunidad de origen. |
| Tamaño y forma del paquete | El número de registros, el número de alertas, la presencia de adjuntos: incluso sin abrir el archivo. |
| Adjuntos | Los `dataUrl` de MEMORIA y los `audio` de LINGUA pueden contener **voces e imágenes identificables**. |
| El canal mismo | La entrega por USB a una persona concreta, en un lugar concreto, es un metadato que el formato no puede proteger. |

**Propiedad de no enlazabilidad, formulada honestamente:** un paquete transportado en frío no revela **quién lo entregó ni a quién** (no hay campos de destinatario, ni direcciones de red, ni marcas de tiempo de transmisión, ni identificadores de sesión). Pero **sí** revela quién **firmó cada registro** y **cuándo lo hizo**. La separación entre el acto de firmar y el acto de entregar es una propiedad real y valiosa del protocolo; la separación entre firmante y persona, no.

**Medidas que un nodo conforme DEBERÍA ofrecer:**

1. Exportar **sin** `author.name` (dejándolo vacío) y sin geolocalización, cuando el usuario lo pida.
2. Permitir registrar una clave **distinta** por contexto (una por comunidad), advirtiendo de que la reputación no se sumará automáticamente entre ellas.
3. Mostrar, antes de exportar, un resumen de lo que el paquete va a revelar: número de registros, huellas distintas, si hay coordenadas, si hay adjuntos, si hay nombres.
4. No incluir por omisión `identity` (clave privada) ni `settings` (claves de API) en un `pangea-exchange`: la implementación de referencia **ya lo hace** —`Store.exportAll()` excluye la colección `identity` y filtra `pref.llm.key` y `pref.translate.endpoint.token`— y declara lo omitido en `omitted` (§9.1, §15.7).

### 15.6 Prohibición de rastreo en el formato de paquete

> **REQUISITO NORMATIVO.** Una implementación conforme **NO DEBE** añadir al formato de paquete ningún identificador de dispositivo, de instalación, de sesión o de usuario; ni analítica, ni contadores de apertura, ni marcas de agua, ni URLs de retorno («call home»), ni campos de telemetría. **NO DEBE** insertar campos ocultos ni codificar información en el orden de los campos o en el nombre de los archivos. **NO DEBE** consultar ninguna red al exportar, importar o verificar.

El formato es un **documento**, no un canal de retorno. Cualquier implementación que necesite métricas **DEBE** obtenerlas por medios distintos del archivo entregado y **DEBE** declararlo al usuario.

El módulo de telemetría de la referencia (`Store.track`, colección `telemetry`) cumple este requisito porque es **estrictamente local**, visible y borrable, y porque `Store.exportAll()` **excluye** la colección mediante `Store.NEVER_EXPORTED`: un `pangea-exchange` exportado nunca la lleva (`counts.telemetry` es `0` y `omitted` la enumera). Una implementación conforme **NO DEBE** incluir telemetría en un paquete exportado.

### 15.7 Secretos que pueden acabar dentro de un paquete

| Secreto | Dónde aparece | Estado en la exportación de referencia |
|---|---|---|
| Clave privada ECDSA | Colección `identity`, campo `priv` (JWK completo, **en claro**) | **Excluida por omisión.** `Store.exportAll()` deja `collections.identity` vacía salvo que se pase `includeIdentity: true`, y lo declara en `omitted`. La interfaz **nunca** pasa esa opción: la clave privada solo sale por el sobre cifrado `PANGEA-ID-1` (§5.2). Si alguien recibiera un archivo con `priv`, podría firmar como el titular para siempre. |
| Contraseña de la identidad portátil | No aparece | El sobre `PANGEA-ID-1` cifra el contenido, pero un `salt`/`iv` cortos y una contraseña débil son atacables fuera de línea con PBKDF2 a 250 000 iteraciones. Se **DEBE** usar una contraseña larga. |
| Clave de API de un modelo de lenguaje | Colección `settings`, clave `pref.llm.key` | **Filtrada siempre.** Está en `Store.SENSITIVE_SETTINGS` y no se exporta nunca; si se descartó alguna, `omitted` incluye `"settings:secretos"`. |
| Token de un traductor propio | Colección `settings`, clave `pref.translate.endpoint.token` | **Filtrada siempre**, igual que la anterior (`Store.SENSITIVE_SETTINGS` = `['pref.llm.key', 'pref.translate.endpoint.token']`). |
| Dirección de un nodo privado | Colección `settings`, claves `pref.node` y `pref.translate.endpoint` | **Sí se exporta.** No son credenciales, pero pueden revelar la topología de una red comunitaria. |
| Datos de salud, ubicación, voz | Colecciones `alerts`, `knowledge`, `vocab` | Contenido legítimo del protocolo; se **DEBERÍA** advertir antes de exportar. |
| Telemetría local | Colección `telemetry` | **No se exporta.** Está en `Store.NEVER_EXPORTED` y queda fuera de todo paquete: `counts.telemetry` es `0` y `omitted` la enumera. Coherente con §15.6. |

> **REQUISITO.** Una implementación conforme **DEBE** excluir por omisión la colección `identity` y las preferencias secretas (`Store.SENSITIVE_SETTINGS`) de cualquier exportación, **DEBE** declarar en `omitted` lo que haya dejado fuera, y **NO DEBE** escribir la clave privada en un archivo que no sea el sobre cifrado `PANGEA-ID-1`. Un importador **NO DEBE** aceptar una identidad que llegue dentro de un paquete de datos: **DEBE** ignorar esa colección y reportarlo (§11.1). Si el usuario pide incluir la identidad, **DEBE** advertirse explícitamente y con lenguaje inequívoco; el **README.txt** del pasaporte ya lo dice en mayúsculas (§9.2).

### 15.8 Nota honesta sobre el dispositivo comprometido

El protocolo **no** puede proteger una clave de un dispositivo comprometido. Si el sistema operativo, el navegador, una extensión, otro usuario de la máquina o un atacante con acceso físico al dispositivo obtiene la clave privada, **todas** las firmas que se produzcan a partir de entonces con esa clave son indistinguibles de las legítimas: son criptográficamente válidas y la referencia las aceptará. El protocolo no ofrece revocación, ni lista de revocación, ni rotación de claves, ni fecha de caducidad.

Consecuencias que una implementación **DEBE** comunicar al usuario:

1. **La clave privada es el usuario.** No hay recuperación de cuenta, ni servicio de atención, ni «he olvidado mi contraseña» que no dependa de un respaldo.
2. **Un dispositivo robado compromete todas las firmas futuras de esa clave**, y las anteriores siguen siendo válidas y verificables (son legítimas: se firmaron con la clave).
3. **La única respuesta a una clave comprometida es dejar de usarla** y publicar, por los canales que se usen, que la huella antigua ya no debe aceptarse. Físicamente no hay nada más que el protocolo pueda hacer, y decir lo contrario sería mentir.
4. **Los respaldos cifrados (`PANGEA-ID-1`) son la única continuidad.** Se **DEBERÍA** insistir en hacerlos, con contraseñas fuertes, y **DEBERÍA** advertirse de que su pérdida es irreversible.

---

## Apéndice A — ejemplo completo y verificación paso a paso

Todos los valores de este apéndice fueron **producidos y verificados** con WebCrypto (ECDSA P-256 + SHA-256, `crypto.subtle`), aplicando exactamente las reglas de §3, §4.1 y §4.2.

### A.1 Clave de prueba (desechable)

> Esta clave se publica **solo** como vector de prueba. **NO DEBE** usarse para nada más. Cualquiera que la lea puede firmar con ella.

**Clave pública (`pub`, cadena literal que debe usarse verbatim):**

```text
{"key_ops":["verify"],"ext":true,"kty":"EC","x":"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0","y":"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU","crv":"P-256"}
```

**La misma clave como objeto JWK (para lectura humana; nótese el orden de claves):**

```json
{
  "key_ops": ["verify"],
  "ext": true,
  "kty": "EC",
  "x": "HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0",
  "y": "JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU",
  "crv": "P-256"
}
```

**Clave privada de prueba (`priv`) — deliberadamente pública:**

```text
{"key_ops":["sign"],"ext":true,"kty":"EC","x":"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0","y":"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU","crv":"P-256","d":"XBGvMfOUHei83kmw9reLGIRk55lNGwQqR3CNxYssgSo"}
```

**Derivación de la huella (paso a paso):**

| Paso | Valor |
|---|---|
| 1. `pub` (UTF-8) | la cadena de arriba (**158 bytes**) |
| 2. SHA-256 hex | `2bca9d98ac7bedfcb2458d09c0f87cc896cd71049a1cb4b16e50b122cc61bbee` |
| 3. Primeros 12 bytes (decimal) | `43, 202, 157, 152, 172, 123, 237, 252, 178, 69, 141, 9` |
| 4. `byte mod 32` | `11, 10, 29, 24, 12, 27, 13, 28, 18, 5, 13, 9` |
| 5. Caracteres del alfabeto | `M L 7 2 N 5 P 6 U F P K` |
| 6. Agrupado | `ML72` · `N5P6` · `UFPK` |
| 7. **Huella** | **`PAN-ML72-N5P6-UFPK`** |

### A.2 Registro firmado (JSON tal como viajaría)

```json
{
  "id": "prob_1a2b3c4d5e",
  "createdAt": 1735689600000,
  "kind": "problem",
  "status": "abierto",
  "title": "El agua de la red llega contaminada dos dias por semana",
  "body": "Necesitamos un filtro de bajo costo y como verificar el agua.",
  "category": "agua",
  "urgency": "high",
  "location": { "label": "Cali, Colombia", "lat": 3.4516, "lng": -76.532 },
  "tags": ["agua", "filtro"],
  "author": { "fingerprint": "PAN-ML72-N5P6-UFPK", "name": "Ana Ruiz", "anon": false },
  "lang": "es",
  "updatedAt": 1735689700000,
  "sig": {
    "sig": "PuLVfIR1LNEepYutAEH2zP0UnBUivnMFnpN3Mh625sfNAYl4+tA92w1O85G9tFMprRgA8Wd+89Qy97VuZwVH0g==",
    "pub": "{\"key_ops\":[\"verify\"],\"ext\":true,\"kty\":\"EC\",\"x\":\"HYYmgTpExJoZi9nhyfxab53157d6pqDdNrPB2DKy1g0\",\"y\":\"JCFz7LYCp6uTYsP66Ihk_wjLJ6afQQkE9QQuRW2gOaU\",\"crv\":\"P-256\"}",
    "fp": "PAN-ML72-N5P6-UFPK",
    "alg": "ECDSA-P256-SHA256",
    "at": 1735689700000
  }
}
```

### A.3 La cadena exacta que se firmó

**369 bytes UTF-8**, sin ningún espacio ni salto de línea (se muestra partida en tres líneas solo por legibilidad del documento; la cadena real es una sola línea):

```text
{"author":{"anon":false,"fingerprint":"PAN-ML72-N5P6-UFPK","name":"Ana Ruiz"},"body":"Necesitamos un filtro de bajo costo y como verificar el agua.","category":"agua","kind":"problem","lang":"es","location":{"label":"Cali, Colombia","lat":3.4516,"lng":-76.532},"tags":["agua","filtro"],"title":"El agua de la red llega contaminada dos dias por semana","urgency":"high"}
```

Observaciones sobre esta cadena (todas comprobadas):

| Observación | Detalle |
|---|---|
| `author` va primero | Orden lexicográfico por unidades de código UTF-16. |
| No aparecen `id`, `createdAt`, `status`, `updatedAt` | Exclusión recursiva (`NOT_SIGNED`, §3.3). La misma cadena se obtiene si este registro se proyecta **anidado** dentro de un paquete (§3.4). |
| Sí aparecen `kind`, `title`, `body`, `category`, `urgency`, `location`, `tags`, `author`, `lang` | Contenido firmado. |
| Sin espacios | El archivo JSON puede ir con sangría; la firma no. |
| Los acentos de `tag`/`label` se emiten sin escapar | `Cali, Colombia` no lleva acentos; `lat`/`lng` son números con la representación decimal más corta. |

**Firma resultante:** 64 bytes = `PuLVfIR1LNEepYutAEH2zP0UnBUivnMFnpN3Mh625sfNAYl4+tA92w1O85G9tFMprRgA8Wd+89Qy97VuZwVH0g==` (88 caracteres Base64). La firma ECDSA es **no determinista** (usa un `k` aleatorio), de modo que volver a firmar el mismo registro con la misma clave produce **otra** firma válida. Lo que **sí** es determinista —y por tanto verificable como vector de prueba— es la cadena canónica y la huella.

### A.4 Verificación paso a paso

```text
ENTRADA: el objeto JSON de A.2 (o cualquier registro con un campo `sig`).

PASO 1 · Localizar el sobre
    env ← obj.sig
    ├─ ¿env es un objeto?                     NO → NO VERIFICABLE (sin_sobre)
    ├─ ¿env.sig es una cadena no vacía?       NO → NO VERIFICABLE (sin_sobre)
    └─ ¿env.pub existe?                       NO → NO VERIFICABLE (sin_sobre)

PASO 2 · Decodificar la firma
    firma ← BASE64_DECODE(env.sig)
    └─ ¿LONGITUD(firma) = 64?                 NO → NO VERIFICABLE (firma_malformada)

PASO 3 · Importar la clave pública del propio sobre
    jwk  ← SI env.pub es cadena: JSON_PARSE(env.pub) SI NO env.pub
    clave ← IMPORTAR_JWK(jwk, "ECDSA", "P-256", uso="verify")
    └─ ¿se pudo importar?                     NO → NO VERIFICABLE (clave_publica_invalida)

PASO 4 · Calcular la identidad real del firmante  [requisito §4.5]
    fp_calc ← "PAN-" + 3 grupos de 4 caracteres
              ALFABETO[b mod 32] para los 12 primeros bytes de
              SHA256_hex( UTF8(env.pub) )
    ALFABETO = ABCDEFGHJKLMNPQRSTUVWXYZ23456789
    ├─ ¿fp_calc = "PAN-ML72-N5P6-UFPK"?       (según A.1)
    ├─ SI env.fp existe y env.fp ≠ fp_calc → NO VERIFICABLE (huella_discrepante)
    └─ Usar fp_calc como identidad; NO usar env.fp.
       (La comprobación se alcanza solo si la firma del PASO 6 ya validó; el orden
        real del código es firma primero, huella después.)

PASO 5 · Construir la cadena firmada
    bytes ← UTF8( CANONICAL(obj) )
    CANONICAL aplica §3 con:
      · claves ordenadas recursivamente (UTF-16)
      · arrays en su orden
      · undefined omitido
      · Uint8Array/Float32Array → array de números
      · ⊆ {sig, signature, updatedAt, _vec, _score, local, id, createdAt, status,
           confirmations, origin, importedFrom, collaborators, seed, score, explain,
           matchedAt, seenBy, curationAvg, curationCount}
        eliminado en TODOS los niveles (una sola lista, recursiva; §3.3)
    RESULTADO ESPERADO: exactamente la cadena de A.3 (369 bytes), tanto si se
    proyecta el registro suelto como si se proyecta el mismo registro anidado
    dentro de un paquete (§3.4).

PASO 6 · Verificar
    ok ← ECDSA_VERIFY( clave, firma, bytes, SHA-256 )     [firma cruda r‖s, NO DER]
    ├─ ok = verdadero → VÁLIDA. El titular de la clave de A.1 firmó este contenido.
    └─ ok = falso     → NO VERIFICABLE (firma_no_valida). El contenido proyectado
                        cambió, o la clave no es la del firmante.

PASO 7 · Informar, distinguiendo siempre tres cosas:
    1) Autoría verificada del CONTENIDO FIRMADO (el autor es fp_calc, nunca env.fp).
    2) Campos NO firmados que pueden haber cambiado, en cualquier nivel:
       id, createdAt, updatedAt, status, confirmations, origin, importedFrom,
       collaborators, seed, score, explain, matchedAt, seenBy, curationAvg,
       curationCount.
    3) Lo que la firma NO dice: que el contenido sea verdadero, ni que el firmante
       sea quien dice ser en la vida real (§15.1).
```

### A.5 Comprobaciones rápidas de autorización (esperado)

| Variante aplicada al registro de A.2 | Resultado esperado |
|---|---|
| Sin cambios | **VÁLIDA** |
| `title` alterado | `firma_no_valida` |
| `body` con un carácter añadido | `firma_no_valida` |
| `category` cambiado a `salud` | `firma_no_valida` |
| `urgency` cambiado a `critical` | `firma_no_valida` |
| `tags` reordenados | `firma_no_valida` |
| `location.lat` = `3.4517` | `firma_no_valida` |
| `author.fingerprint` cambiado | `firma_no_valida` |
| `author.name` cambiado | `firma_no_valida` |
| `lang` cambiado a `en` | `firma_no_valida` |
| `id` cambiado | **VÁLIDA** (exclusión recursiva, §3.3) |
| `createdAt` cambiado | **VÁLIDA** (exclusión recursiva) |
| `updatedAt` cambiado o eliminado | **VÁLIDA** (exclusión recursiva) |
| `status` cambiado a `resuelto` | **VÁLIDA** (exclusión recursiva) |
| `sig` reordenado internamente, `at` cambiado | **VÁLIDA** (el sobre no forma parte de la proyección) |
| `sig.fp` cambiado a otra huella | **NO VERIFICABLE**: `Crypto.verify` devuelve falso al no coincidir `fp` con la huella recalculada de `pub` (§4.4 paso 6, §4.5); `signerOf().spoofed` es `true` |
| `sig.fp` **eliminado** | **VÁLIDA**: el campo es opcional y su ausencia no impide verificar; la identidad se toma de la huella recalculada |
| `sig.pub` sustituido por otra clave + firma nueva de esa clave (y `fp` coherente con ella) | Firma **VÁLIDA** respecto de la clave nueva; `fp_calc` cambia ⇒ se detecta la suplantación comparando con `author.fingerprint`, que **sí** está firmado |
| El registro de A.2, anidado en `alerts[]` de un paquete firmado: verificar su firma contra **su propia** proyección | **VÁLIDA**, y la cadena es **idéntica** a la del registro suelto: la proyección no cambia por estar anidado (§3.4) |
| El mismo caso, alterando `id`, `createdAt`, `status`, `origin`, `importedFrom` y `confirmations` del registro **anidado** | **VÁLIDA** la firma del registro **y** la firma del paquete: esos campos están excluidos en todos los niveles (§3.4) |
| El mismo caso, pero verificando la firma del registro contra la proyección **del paquete** completa, o la firma del paquete contra la proyección del registro | `firma_no_valida` en ambos casos: son dos objetos distintos, y por tanto dos cadenas firmadas distintas —**no** porque la exclusión dependa del nivel |

### A.6 Receta mínima para un verificador en otro lenguaje

1. Un analizador JSON cualquiera (el orden de claves del archivo **no** importa: la proyección reordena).
2. SHA-256, Base64 estándar y ECDSA P-256 con verificación de firma **cruda `r‖s`** de 64 bytes. En la mayoría de bibliotecas esto significa convertir `r‖s` a `(r, s)` y verificar; el modo DER de las bibliotecas **no** sirve directamente.
3. Un serializador JSON que (a) no añada espacios, (b) ordene claves como UTF-16 y no con `localeCompare`, (c) no escape caracteres no ASCII, (d) emita los números con representación corta. En lenguajes con distinto comportamiento por defecto (Python con `ensure_ascii=True`, Java con mapas `TreeMap` ordenados por *collation*, Go con `encoding/json` que escapa `<`, `>` y `&`): **hay que forzar el comportamiento, no confiar en el defecto**. En particular, Go escapa `<`, `>` y `&` como `\u003c`, `\u003e` y `\u0026`, lo que produciría una cadena distinta y **rompería todas las firmas**.
4. La lista de exclusión de §3.3 —**una sola, los 20 nombres, aplicada recursivamente en todos los niveles**— y la comprobación de que `sig.fp`, si existe, es la huella de `pub` (§4.5).

---

## Apéndice B — Formatos de archivo: referencia rápida

| Formato | Archivo | Entradas / campos raíz | Firmado |
|---|---|---|---|
| Pasaporte | `pangea-passport-YYYY-MM-DD.pangea.zip` | `manifest.json` (firmado), `data.json`, `README.txt` | manifiesto |
| Intercambio | parte de `data.json` | `format, spec, app, exportedAt, counts, omitted, collections` | registros individuales |
| SOS | `pangea-sos-YYYY-MM-DD.json` | `format, spec, exportedAt, origin, alerts[], sig` | paquete completo |
| Memoria | `pangea-memoria-YYYY-MM-DD.zip` | `manifest.json` (firmado, `sig` + `signature`), `knowledge.json`, `curations.json` | manifiesto (4 campos) |
| LINGUA | `pangea-diccionario-YYYY-MM-DD.json` | `format, spec, exportedAt, languages[], words[]` | palabras individuales |
| Fraseo | `data/frases-emergencia.json` | `version, format, note, languages[], phrases[]` | no |
| SYNAPSE | `pangea-synapse-YYYY-MM-DD.json` | `format, spec, exportedAt, problems[], capacities[], matches[]` | registros individuales |
| VERITAS | `veritas-{claimId}.json` | `format, spec, app, exportedAt, claim, votes[], weights, consensus, anomaly, credibility` | afirmación y votos |
| Identidad | `pangea-identity-{huella}.json` | `format, kdf, cipher, salt, iv, data, fingerprint, createdAt` | AES-GCM (autenticado) |

Extensiones aceptadas por los importadores de la interfaz: `.json`, `.zip`, `.pangea`, `application/json`, `application/zip`. Los importadores seleccionan el camino por extensión **o** por `file.type === "application/zip"`.

---

## Apéndice C — Constantes normativas (hoja de referencia)

| Constante | Valor exacto |
|---|---|
| Curva | P-256 |
| Hash de firma | SHA-256 |
| Algoritmo declarado | `"ECDSA-P256-SHA256"` |
| Longitud de firma | 64 bytes (`r‖s`), 88 caracteres Base64 |
| Alfabeto de huella | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32) |
| Bytes de huella | 12, tomados del inicio del SHA-256 |
| Formato de huella | `PAN-XXXX-XXXX-XXXX` |
| KDF | PBKDF2-SHA256, **250 000** iteraciones |
| Cifrado de identidad | AES-GCM-256 |
| Sal / IV de identidad | 16 bytes / 12 bytes |
| Contraseña mínima al exportar | 8 caracteres |
| Formatos de paquete | `pangea-exchange`, `pangea-passport`, `pangea-sos`, `pangea-memoria`, `pangea-lingua-dictionary`, `pangea-phrasebook`, `pangea-synapse`, `pangea-veritas-claim`, `PANGEA-ID-1`, `pangea.statement` |
| Versión | `spec: "1.0"` |
| Nombres de colección | `problems, capacities, matches, claims, votes, knowledge, curations, alerts, responses, vocab, agents, events, settings, identity, telemetry` |
| Nombres de exclusión (una sola lista, recursiva en todos los niveles) | `sig, signature, updatedAt, _vec, _score, local, id, createdAt, status, confirmations, origin, importedFrom, collaborators, seed, score, explain, matchedAt, seenBy, curationAvg, curationCount` (20) |
| Preferencias que nunca se exportan | `pref.llm.key`, `pref.translate.endpoint.token` (`Store.SENSITIVE_SETTINGS`) |
| Colección excluida por omisión al exportar | `identity` (`Store.exportAll({ includeIdentity: false })`); se declara en `omitted` |
| Colección que la importación genérica nunca escribe | `identity` (`report.identitySkipped`) |
| Formato aceptado por el importador genérico | `"pangea-exchange"` (cualquier otro `format` declarado se rechaza) |
| Método ZIP | 0 (stored) |
| Flag ZIP | `0x0800` |
| Polinomio CRC-32 | `0xEDB88320` |
| Umbral de emparejamiento (política) | `score >= 45` |
| Umbrales de consenso (política) | 5 votos, 66 % |
| Pesos de voto (política) | `true=1`, `false=−1`, `context=0.35`, `unverifiable=0` |
| Pesos de urgencia (política) | `low=2`, `medium=5`, `high=8`, `critical=10` |
| Tamaño máximo de adjunto (referencia) | 8 MiB |

---

## Apéndice D — Divergencias conocidas con la implementación de referencia (no normativo)

Registro honesto de los puntos en los que el código **no** coincide con la lectura intuitiva del protocolo, o donde este documento exige más de lo que el código hace. Ninguna de estas divergencias impide la interoperabilidad de datos; las marcadas con ⚠ afectan a la seguridad y **DEBERÍAN** corregirse en una implementación nueva. Las marcadas con ✅ **estuvieron abiertas y ya no lo están**: la fila se conserva porque explica por qué existe la regla y porque una reimplementación que ignore la lección volvería a introducir el fallo.

| # | Punto | Lo que hace el código | Lo que dice esta especificación |
|---|---|---|---|
| D1 ✅ | **Resuelta.** La huella declarada `sig.fp` ya no se acepta a ciegas | **Antes:** `Crypto.verify` usaba `sig.pub` y **nunca** comparaba `sig.fp`; `signerOf` devolvía `sig.fp` sin recalcular. **Ahora:** `Crypto.verify` realiza **dos** comprobaciones —firma válida para `sig.pub` **y**, si `sig.fp` existe, `sig.fp === fingerprintOf(sig.pub)`— y devuelve **falso** cuando la huella discrepa; `signerOf` **siempre** recalcula desde `pub` y añade `claimed` y `spoofed`. | §4.5 y §15.2 documentan la regla, que sigue siendo **normativa** para cualquier reimplementación. La nota histórica explica por qué existe: sin la segunda comprobación, suplantar la huella era trivial. |
| D2 ✅ | **Resuelta.** `verifyAttestation` ya no compara `sig.fp` con `from` | **Antes:** `matchesIssuer = (att.sig.fp === att.from)`, sobre un campo no autenticado. **Ahora:** recalcula `signerFingerprint = fingerprintOf(att.sig.pub)`, lo compara con `from` y devuelve `matchesIssuer`, `signerFingerprint`, `declaredIssuer` y un veredicto de **tres** valores: `"válida"`, `"firma válida, emisor no coincide"` o `"no verificable"`. | §6.3 documenta el procedimiento y los tres veredictos; §6.4 exige que «firma válida, emisor no coincide» **no** se contabilice a favor del emisor declarado. La comparación explícita con `sig.fp` ya no hace falta: `verify` la hace por dentro. |
| D3 ✅ | **Resuelta.** `Store.exportAll()` ya no incluye la identidad ni los secretos | **Antes:** `for (const c of ALL)` recorría las 15 colecciones, de modo que el `data.json` de un pasaporte contenía la **clave privada en claro** (`identity.self.priv`) y `settings` con `pref.llm.key`. **Ahora:** `exportAll({ includeIdentity = false })` excluye la colección `identity` **por omisión**, filtra `Store.SENSITIVE_SETTINGS` (`pref.llm.key`, `pref.translate.endpoint.token`) y declara lo omitido en `omitted`; la interfaz nunca pasa `includeIdentity: true`, y `passportReadme()` lo dice en mayúsculas: «Tu CLAVE PRIVADA no viaja en este archivo». | §9.1, §9.2 y §15.7 documentan el comportamiento actual, y §5.2 fija que la identidad viaja **solo** por el sobre cifrado `PANGEA-ID-1`. La nota histórica es la razón de la regla: un pasaporte está pensado para llevarse en un USB, así que incluir la clave lo convertía en una filtración de identidad. |
| D4 ⚠ | La razón declarada en el comentario de `ctx.publish` es inexacta | El comentario dice que `id` y `createdAt` se generan antes de firmar porque, si los asignara la base de datos después, «la firma no volvería a coincidir nunca». En realidad esos campos están en la lista de exclusión `NOT_SIGNED`, por lo que **nunca** forman parte de lo firmado, se generen antes o después. | §3.3 documenta la exclusión como la única razón real. El orden de generación es irrelevante para la firma (aunque sí determina qué `id` se persiste). |
| D5 ⚠ | `pangea-sos`: la firma del paquete **no** cubre `origin` | `origin` está en `NOT_SIGNED` (§3.3) y, en el paquete SOS, es una clave de raíz. La firma del paquete no la protege. Con la lista recursiva, la firma del paquete tampoco cubre `status`, `origin`, `importedFrom`, `confirmations`, `id` ni `createdAt` de las alertas anidadas. | §9.3 lo advierte explícitamente y §12.4 obliga a derivar la huella del emisor de `sig.pub`. Un nodo **NO DEBE** mostrar `origin.fingerprint` como autoría. |
| D6 | SOS normaliza campos **firmados** al importar | `type` desconocido → `other`; `severity` desconocida → `medium`; `title` truncado a 160; `body` truncado a 2000; `status` fuera de `atendida` → `activa`. `type`, `severity` y `title` **sí** están firmados, de modo que un valor no estándar se reescribe y **la firma del registro deja de verificar** en el almacén del receptor. | §12.3/A6 recomienda conservar el valor original de los campos firmados. |
| D7 | SOS importa aunque el paquete no verifique | `pkgValid` se calcula y se muestra, pero los registros se escriben igualmente. | §12.2/R6 exige que lo no verificado **nunca** se presente como verificado; permite la política permisiva con marcado explícito (que es, de hecho, la que el código aplica en la interfaz). |
| D8 | `importAll` conserva `updatedAt`; el camino SOS lo reescribe | El genérico escribe el registro tal cual; SOS usa `Store.put`, que fija `updatedAt = Date.now()`. Así una alerta importada domina versiones posteriores con marcas antiguas. | §11.4 señala el efecto y recomienda conservar el `updatedAt` de origen. |
| D9 | `report.skipped` incluye sobrescrituras aplicadas | Una fila que **sí** se escribió reemplazando a una anterior cuenta en `skipped`. | §11.3 obliga a no presentar `skipped` como «no importado» y recomienda contadores separados. |
| D10 | `importAll` no marca procedencia ni verifica firmas | Escribe los registros sin añadir `origin`/`importedFrom` y sin mirar `sig`. Lo que **sí** hace ya: rechazar cualquier `format` distinto de `pangea-exchange` y omitir siempre la colección `identity` (§11.1). | §12.4 lo exige para una importación conforme: la comprobación de formato y la exclusión de la identidad ya se cumplen; siguen faltando la verificación por registro y el marcado de procedencia. |
| D11 | Colecciones desconocidas se pierden | `importAll` recorre solo nombres conocidos: una colección nueva de otro nodo se descarta. | §13.2 recomienda conservarlas y reenviarlas para compatibilidad hacia adelante. |
| D12 | El lector ZIP no verifica el CRC-32 | `unzipSync` extrae los bytes sin comprobar el CRC. | §10.6 recomienda verificarlo y marcar las entradas que no coincidan. |
| D13 | `importIdentity` ignora `kdf` y `cipher` | Los parámetros están codificados en duro; un sobre con otro `kdf` pero `format` correcto falla como «contraseña incorrecta». | §5.4 exige rechazar explícitamente los parámetros no soportados. |
| D14 | `importIdentity` no comprueba coherencia de huella | No verifica que `bundle.fingerprint` corresponda a la clave descifrada, ni avisa de que sobrescribe la identidad existente. | §5.4 lo recomienda. |
| D15 | `pangea-lingua-dictionary` no está firmado | El paquete no lleva `sig`; solo las palabras conservan su firma individual. Lo mismo ocurre con `pangea-synapse` y `pangea-veritas-claim`. | Se documenta como comportamiento esperado: la firma de paquete es **opcional** en el protocolo. Un importador **DEBE** verificar registro a registro. |
| D16 | Campos de exclusión sin productor | `seenBy`, `matchedAt`, `curationAvg`, `curationCount`, `_vec`, `_score` y `local` están en la lista de exclusión `NOT_SIGNED` pero **ningún** módulo los produce hoy. | Se documentan como **reservados**: siguen siendo obligatorios para interoperar (una implementación que los incluyera en su proyección no coincidiría con la referencia si algún día aparecen), y lo son **en todos los niveles** (§3.3). |
| D17 ✅ | **Resuelta.** El `README.txt` del pasaporte ya no da una instrucción inexacta | **Antes:** decía «selecciona `data.json`», cuando el importador de la interfaz acepta también el `.zip` completo. **Ahora:** dice «selecciona este archivo .zip (o el data.json que contiene dentro)», que describe las dos rutas realmente admitidas, y añade un bloque en mayúsculas «QUÉ NO CONTIENE, Y POR QUÉ» explicando que la clave privada no viaja en el archivo y que la identidad se exporta aparte con `PANGEA-ID-1`. | El README es **no normativo**: se **DEBE** ignorar al verificar. Su texto actual reproduce exactamente lo que hace la interfaz (§9.2). |
| D18 | `origin.fingerprint` y `author.fingerprint` pueden ser `local-anon` | Al publicar sin identidad, `author` = `{fingerprint:"local-anon", name:"—", anon:true}` y el registro **no se firma**. | §4.2 advierte de que `local-anon` no es una huella derivable: un verificador **DEBE** tratarla como no verificable, y **DEBERÍA** mostrarla como «autor anónimo local». |
| D19 | Los datos semilla usan una huella ficticia | `data/conocimiento-semilla.json` declara `author.fingerprint: "PAN-SEED-0000-0000"`, que contiene `0` y no es derivable del alfabeto del protocolo. | §4.2 lo señala; §14 permite que un nodo conforme muestre esos registros como ejemplos no verificables (la referencia los marca con `seed: true` y los rotula «Demostración»). |
| D20 ✅ | **Resuelta.** El worker de sincronización y el camino usado ya coinciden | **Antes:** `sync.worker.js` proponía `/pangea/health` y `/pangea/sync` (GET/POST) con `Bearer`, mientras `syncNow()` en `js/app.js` hacía `POST {url}/pangea/alerts` con `{alerts}`. **Ahora:** `syncNow()` hace `POST {nodo}/pangea/sync` con el **paquete `pangea-exchange` completo** y 15 000 ms de límite, e importa la respuesta con `Store.importAll()` cuando trae `collections`; el endpoint `/pangea/alerts` **ya no existe**. Es exactamente el contrato de `sync.worker.js` (`ping` → `GET /pangea/health`, `push` → `POST /pangea/sync`, `pull` → `GET /pangea/sync?since=…`). | El contrato es ahora **uno solo** (§1.4), pero sigue siendo **no normativo**: no hay ninguna implementación de servidor en el repositorio. PANGEA no tiene servidores; esto es la interfaz que una comunidad que despliegue su propio nodo tiene que implementar si quiere sincronizar. |
| D21 ✅ | `Store.exportAll()` incluía la colección `telemetry` | **Resuelta.** El recorrido de colecciones consulta ahora `Store.NEVER_EXPORTED` (`[identity, telemetry]`), así que un `pangea-exchange` exportado nunca lleva los contadores diarios locales: `collections.telemetry` es `[]`, `counts.telemetry` es `0` y `omitted` incluye `"telemetry"`. | Se mantenía que §15.6 prohíbe transportar telemetría en un paquete y §7.13 marca `telemetry` como **NO DEBE** transportarse: la promesa del proyecto es que la telemetría nunca sale del dispositivo, y un paquete puede acabar en un nodo comunitario ajeno. |
| D22 | `Crypto.verify()` no distingue los dos modos de fallo | Devuelve un booleano: `firma_no_valida` y `huella_discrepante` (§4.4) son indistinguibles desde esa función. La referencia expone la diferencia solo por `Crypto.signerOf()`, cuyo campo `spoofed` es `true` cuando `sig.fp` no corresponde a `sig.pub`. | §4.4 define códigos distintos para cada causa y recomienda exponerlos por separado. Un nodo conforme **DEBERÍA** distinguir «firma no válida» de «huella suplantada» al informar. |

---

*Fin del documento. Esta especificación describe el protocolo PANGEA 1.0 tal como lo implementa la versión de referencia v1.0.0. Cualquier divergencia entre este texto y el código se resuelve a favor del código, y debe reportarse como error de esta especificación.*
