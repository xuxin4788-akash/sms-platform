# Asignación de extensiones - Teléfono Web

Las extensiones **1001 a 1050** (50 extensiones) las genera automáticamente el
contenedor Asterisk al arrancar. Todas comparten la **misma contraseña inicial**,
definida en la variable `PHONE_PEER_SECRET` del archivo `.env` (no escribirla
aquí en claro).

## Cómo se entregan a los agentes

1. El administrador asigna un número de la tabla a cada agente y le entrega:
   - Extensión (por ejemplo `1001`)
   - Contraseña inicial (`PHONE_PEER_SECRET`)
   - Dirección del teléfono: `https://pagoserve.com/static/phone/`
2. El agente abre la dirección, escribe su extensión y contraseña y pulsa **Conectar**.
3. Marcando **7777** se prueba el eco (autocomprobación de audio).

## Capacidad

- Extensiones disponibles: **50** (1001-1050), una por agente.
- Puertos de medios RTP: **10000-10200** (cada llamada ocupa 2 puertos UDP;
  con 50 llamadas simultáneas se usan 100, el resto queda de margen).
- El cortafuegos debe permitir **UDP 10000-10200** y **UDP 5060**.

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
| 1021 |  | Libre |
| 1022 |  | Libre |
| 1023 |  | Libre |
| 1024 |  | Libre |
| 1025 |  | Libre |
| 1026 |  | Libre |
| 1027 |  | Libre |
| 1028 |  | Libre |
| 1029 |  | Libre |
| 1030 |  | Libre |
| 1031 |  | Libre |
| 1032 |  | Libre |
| 1033 |  | Libre |
| 1034 |  | Libre |
| 1035 |  | Libre |
| 1036 |  | Libre |
| 1037 |  | Libre |
| 1038 |  | Libre |
| 1039 |  | Libre |
| 1040 |  | Libre |
| 1041 |  | Libre |
| 1042 |  | Libre |
| 1043 |  | Libre |
| 1044 |  | Libre |
| 1045 |  | Libre |
| 1046 |  | Libre |
| 1047 |  | Libre |
| 1048 |  | Libre |
| 1049 |  | Libre |
| 1050 |  | Libre |

## Notas de seguridad

- La contraseña es única y compartida: al cambiar `PHONE_PEER_SECRET` en `.env`
  y recrear el contenedor, todas las extensiones pasan a usar la nueva.
- Como mejora posterior se recomienda que la plataforma entregue a cada usuario
  su extensión y una credencial distinta tras iniciar sesión (requiere una pequeña
  integración con el backend).
