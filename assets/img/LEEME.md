# assets/img

Carpeta reservada para las imágenes del proyecto.

Actualmente está **vacía a propósito**. PANGEA no incluye capturas de pantalla
en el manifiesto PWA porque preferimos no publicar imágenes de una interfaz que
todavía no ha sido revisada en todos los dispositivos objetivo, antes que
incluir material de relleno.

Cuando haya capturas reales (una de escritorio a 1280×800 y otra de móvil a
720×1280), colócalas aquí con los nombres `captura-escritorio.png` y
`captura-movil.png`, y vuelve a añadir el bloque `screenshots` a
`manifest.json`. Eso mejora la ficha de instalación en Android y ChromeOS.

Los iconos de la aplicación **no** van aquí: se generan con
`node tools/build-assets.mjs` en `assets/icons/`.
