# Cliente de Escritorio - Plataforma de Marketing SMS

Cliente de escritorio construido con **Electron** que actua como ventana dedicada
para acceder al servidor central de la plataforma. El backend y los datos siguen
en el servidor; esta aplicacion solo es un cliente de acceso.

## Requisitos para desarrollar/empaquetar

- Node.js 18+ (recomendado 20)
- En Windows: Windows 10/11
- En macOS: macOS 11+ (para firmar/notarizar se necesita cuenta de Apple)
- En Linux: dependencias de Electron GTK (AppImage)

## Uso en desarrollo

```bash
cd desktop
npm install
npm start
```

Al iniciar por primera vez se abre la ventana de configuracion:

1. Introduce la direccion del servidor (ej. `http://47.87.38.52` o
   `https://sms.tuempresa.com`).
2. Pulsa **Probar conexion** para verificar.
3. Pulsa **Guardar y continuar**.

La direccion se guarda en el equipo del usuario
(`userData/server-config.json`) y en los siguientes arranques se abre
directamente la plataforma.

Si el servidor no es accesible al iniciar, se vuelve a mostrar la pantalla de
configuracion automaticamente.

## Generar el instalador de Windows (.exe)

En un equipo **Windows** (recomendado):

```bash
cd desktop
npm install
npm run dist:win
```

Los instaladores se generan en `desktop/dist/`:

- `SMS-Plataforma-Setup-1.0.0.exe` — instalador clasico NSIS (permite elegir
  carpeta, crea accesos directos).
- `SMS-Plataforma-Portable-1.0.0.exe` — version portable, no requiere
  instalacion.

> Nota: electron-builder no puede producir binarios fiables de Windows desde
> Linux/macOS sin Wine. La forma mas sencilla y segura es construir en Windows
> (fisico o maquina virtual) o usar el flujo de CI descrito abajo.

## Compilacion automatica con GitHub Actions

El repositorio incluye el workflow `.github/workflows/desktop.yml`. Cada vez que
se publique un tag con el prefijo `desktop-v` (por ejemplo `desktop-v1.0.0`),
se construyen automaticamente los instaladores para Windows, macOS y Linux, y
se suben como artefactos de la ejecucion.

Pasos:

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

Luego, en GitHub: Actions → ejecucion del workflow → descarga el artefacto
`sms-plataforma-win` (contiene el `.exe`).

Tambien puedes lanzar la compilacion manualmente desde la pestana Actions
(boton "Run workflow").

## Menu de la aplicacion

- **Archivo → Recargar** (Ctrl+R): recarga la pagina.
- **Archivo → Reconfigurar servidor...**: vuelve a la pantalla de configuracion
  para cambiar la direccion del servidor.
- **Ver → Herramientas de desarrollador** (F12): consola para depuracion.

## Notas de seguridad

- El cliente usa `contextIsolation: true`, `nodeIntegration: false` y `sandbox:
  true` en la ventana principal; solo la ventana de configuracion tiene un
  `preload` reducido que expone unicamente `testServer` y `saveServer`.
- El contenido que se carga es la URL del servidor configurado por el usuario.
- Los datos y credenciales residen en el servidor central, no en el cliente.
