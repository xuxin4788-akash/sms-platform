# Teléfono Web - Guía de despliegue

Softphone en el navegador para la plataforma. El agente marca desde
`https://pagoserve.com/static/phone/`; el audio y la señalización pasan por un
contenedor Asterisk que enlaza con el conmutador **VOS3000** mediante una troncal
de IP estática.

## Arquitectura

```
Navegador (SIP.js, WebRTC)
   │  wss://pagoserve.com/ws      (TLS lo termina nginx)
   ▼
nginx (contenedor existente)  ── proxy /ws ──►  Asterisk :8089 (contenedor nuevo)
                                                 │  PJSIP, G.711/Opus
                                                 ▼
                                          VOS3000 43.112.27.24:5060
                                                 ▼
                                            Cliente final
```

- Navegador ↔ Asterisk: WebRTC (SRTP/DTLS + ICE/STUN).
- Asterisk ↔ VOS3000: SIP/RTP normales, IP estática (sin registro ni contraseña).
- Sin transcodificación: ambos lados usan G.711 (ulaw/alaw); no se instala Opus.

> Elección de la imagen base (validado contra los archivos oficiales):
>
> - Debian **bookworm (12) / trixie (13) no incluyen Asterisk** en ninguna
>   componente (`apt`: "no installation candidate").
> - Debian **bullseye** incluye Asterisk 16.28, pero está fuera de soporte y su
>   suite `bullseye-security` se eliminó de los espejos: el índice referencia
>   `.deb` que ahora dan 404, así que no permite construir de forma fiable.
> - **Ubuntu 24.04 (noble), componente `universe`, incluye Asterisk 20.6 LTS**
>   mantenido; `chan_pjsip`, `res_pjsip`, el transporte WebSocket y SRTP están
>   dentro de `asterisk-modules`, con un archivado normal y consistente.
>
> El Dockerfile usa por tanto `ubuntu:24.04`. El códec es G.711 (ulaw/alaw)
> en ambos lados, sin transcodificación; no se instala Opus (aunque Asterisk
> 20 lo incluya, no hace falta para los navegadores con G.711).

## Requisitos previos

1. En `.env` define `PHONE_PEER_SECRET` (contraseña inicial de las extensiones)
   y, si aplica, `VOS3000_HOST`, `VOS3000_PORT`, `VOS3000_PREFIX`.
2. Reglas de firewall / grupo de seguridad:
   - Entrada UDP `10000-10100` en este servidor (medio navegador ↔ Asterisk).
   - Entrada UDP `5060` (señalización de la troncal).
   - En el servidor VOS3000: entrada UDP `5060` y UDP `10000-20000`,
     origen restringido a `47.87.38.52/32`.
3. VOS3000 debe autorizar este servidor por IP de origen.

## Despliegue

```bash
cd /opt/sms-platform
# tras hacer pull de los nuevos archivos (asterisk/, static/phone/, compose)
docker compose build asterisk
docker compose up -d
docker compose restart nginx     # recarga la plantilla con location /ws
```

Verificación:

```bash
docker compose logs --tail=50 asterisk     # peers generados, arranque OK
docker compose exec asterisk asterisk -rx "pjsip show endpoints" | head
```

En el navegador: abrir `https://pagoserve.com/static/phone/`, entrar con una
extensión (1001) y la contraseña, y marcar **7777** para la prueba de eco.

## Asignación de agentes

Ver `static/phone/ASIGNACION.md`. El contenedor crea 1001-1020 automáticamente.

## Pendiente operativo

- **Formato de marcado del proveedor** (10 dígitos / prefijo 52 / 0052): se
  controla con `VOS3000_PREFIX`. Debe confirmarse con el proveedor de la línea;
  sin ese dato la llamada puede conectar la señalización pero no completarse o
  tarificarse mal.
- Como mejora, la plataforma puede entregar a cada usuario su extensión y
  credencial propia tras iniciar sesión, en lugar de una contraseña compartida.
