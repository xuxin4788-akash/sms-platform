# Asignación de extensiones - Teléfono Web

Las extensiones **1001 a 1020** las genera automáticamente el contenedor Asterisk
al arrancar. Todas comparten la **misma contraseña inicial**, definida en la
variable `PHONE_PEER_SECRET` del archivo `.env` (no escribirla aquí en claro).

## Cómo se entregan a los agentes

1. El administrador asigna un número de la tabla a cada agente y le entrega:
   - Extensión (por ejemplo `1001`)
   - Contraseña inicial (`PHONE_PEER_SECRET`)
   - Dirección del teléfono: `https://pagoserve.com/static/phone/`
2. El agente abre la dirección, escribe su extensión y contraseña y pulsa **Conectar**.
3. Marcando **7777** se prueba el eco (autocomprobación de audio).

## Tabla (completar con el nombre del agente)

| Extensión | Nombre del agente | Estado |
|-----------|-------------------|--------|
| 1001 |  | Libre |
| 1002 |  | Libre |
| 1003 |  | Libre |
| 1004 |  | Libre |
| 1005 |  | Libre |
| 1006 |  | Libre |
| 1007 |  | Libre |
| 1008 |  | Libre |
| 1009 |  | Libre |
| 1010 |  | Libre |
| 1011 |  | Libre |
| 1012 |  | Libre |
| 1013 |  | Libre |
| 1014 |  | Libre |
| 1015 |  | Libre |
| 1016 |  | Libre |
| 1017 |  | Libre |
| 1018 |  | Libre |
| 1019 |  | Libre |
| 1020 |  | Libre |

## Notas de seguridad

- La contraseña es única y compartida: al cambiar `PHONE_PEER_SECRET` en `.env`
  y reiniciar el contenedor, todas las extensiones pasan a usar la nueva.
- Como mejora posterior se recomienda que la plataforma entregue a cada usuario
  su extensión y una credencial distinta tras iniciar sesión (requiere una pequeña
  integración con el backend).
