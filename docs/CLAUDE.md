# IMPACTOS — Instrucciones para Claude

Ver [DOCUMENTACION.md](DOCUMENTACION.md) para la arquitectura, el modelo de datos y los módulos.

## Cómo trabajar en este repo

- **No usar Playwright ni levantar el navegador** para verificar cambios, salvo que se pida
  explícitamente. Verificar con `node --check` sobre los módulos y con pruebas del motor de
  cálculo en Node. Al entregar, decir con claridad qué quedó sin verificar visualmente.
- **No hacer `git commit` ni `git push`** sin que se pida explícitamente.
- El despliegue es GitHub Pages desde `main`, así que un deploy implica commitear ahí.
  Al desplegar, subir también el contador de caché del Service Worker en `sw.js`.
- La versión de la app vive en `APP_VERSION` (`js/app.js`) y se refleja en `DOCUMENTACION.md`.
  Subirla **una sola vez por despliegue**, no por cada iteración sin publicar.
- Deploy de prueba (a confirmar en el teléfono real antes de darlo por bueno): sufijo `-Tn` sobre
  la última versión oficial (`1.9.3` → `1.9.3-T1`, `-T2`...), sin subir el número base. Deploy
  oficial: sube el número base y se quita el sufijo (`1.9.3-T1` → `1.9.4`). Ver "Versionado" en
  DOCUMENTACION.md.

## Convenciones del código

- JavaScript ES6+ vanilla, sin framework ni build step. Módulos con `import()` dinámico.
- Cada módulo exporta `render(container, ...args)` y pinta con template strings.
- Los cálculos financieros viven en `js/utils/`, separados de la UI, y se prueban en Node.
- Comentarios y textos de UI en español.
