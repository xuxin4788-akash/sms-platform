# Guia de despliegue en un servidor nuevo

Esta guia instala la plataforma (SMS + Llamadas de voz) en un servidor Ubuntu/Debian
limpio usando Docker + docker-compose. Cada instalacion es independiente: tiene su
propia base de datos PostgreSQL en un volumen Docker, de modo que puede convivir con
la instancia anterior sin compartir datos.

## 1. Requisitos del servidor

- Ubuntu 22.04 / Debian 12 (o superior)
- Minimo 2 vCPU / 4 GB RAM / 20 GB disco
- Puertos 80 (y opcionalmente 443) abiertos
- Acceso root o sudo

## 2. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version    # si este comando falla, usar docker-compose (v1)
```

## 3. Clonar el repositorio

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/xuxin4788-akash/sms-platform.git sms-platform
cd sms-platform
```

> Si el repo es privado, configure una llave Deploy key o use un token:
> `git clone https://<TOKEN>@github.com/xuxin4788-akash/sms-platform.git`

## 4. Configurar variables de entorno

```bash
cp .env.example .env
# Generar claves seguras
SECRET=$(openssl rand -hex 32)
DBPASS=$(openssl rand -base64 24 | tr -d '/+=')
sed -i "s|your_secure_password_here|$DBPASS|" .env
sed -i "s|generate_a_random_hex_string_here|$SECRET|" .env
cat .env
```

Edite `.env` si necesita algo distinto. NO comparta este archivo.

## 5. Levantar la pila completa

Con Docker Compose v2 (recomendado):

```bash
docker compose up -d --build
```

Con Docker Compose v1:

```bash
docker-compose up -d --build
```

> Si usa docker-compose v1 y ve `KeyError: 'ContainerConfig'` o `No such image`,
> ejecute `docker-compose down` (SIN `-v`) y vuelva a `up -d --build`.
> **NUNCA** ejecute `down -v`: borraria el volumen de PostgreSQL y todos los datos.

## 6. Verificar

```bash
docker compose ps
curl -I http://127.0.0.1/
# HTTP/1.1 200 OK
```

Abra `http://IP_DEL_SERVIDOR/` en el navegador. Credenciales por defecto:

- Usuario: `admin`
- Contrasena: `admin123`

**Cambie la contrasena del admin inmediatamente** despues del primer inicio de sesion
(Mi Cuenta → Cambiar contrasena).

## 7. Configurar SMS (opcional)

1. Entre como admin.
2. Menu → **Configuracion API SMS**.
3. Cree una configuracion por pais con los datos del proveedor (infin8linx):
   `domain`, `spid`, `api_pwd`, `sender_name`.
4. Marquela como activa.
5. Los equipos (Team Admins) pueden seleccionar la API en **Mi Equipo → API**.

Mientras no haya API configurada, la plataforma funciona en **modo simulacion**.

## 8. Configurar Llamadas de Voz (电呼, opcional)

La nueva funcionalidad de **Llamadas** usa TTS (texto a voz) para reproducir un
guion al responder el cliente.

1. Menu → **Configuracion Voz**.
2. Proveedor soportado: **Twilio** (hay tambien un modo "Proveedor personalizado
   HTTP" para integrar otra pasarela).
3. Complete:
   - **Account SID** y **Auth Token** (del panel de Twilio)
   - **Numero remitente (from)**: un numero de Twilio habilitado para voz,
     en formato E.164 (`+15551234567`)
4. Guardar y pulsar **Probar conexion**.
5. Vaya a **Llamadas**, escriba el guion (usa `{nombre}` y `{telefono}` como
   variables) y lance la tanda.

Mientras no haya API configurada, las llamadas se generan en **modo simulacion**
(se marcan como completadas/fallidas de forma ficticia para probar la UI).

### Notas sobre Twilio en Latinoamerica

- Para llamadas a Mexico (+52), Colombia (+57), etc., verifique que el numero
  remitente pueda terminar llamadas hacia ese pais. Algunos paises requieren
  numeros geograficos o registro de marca.
- El costo por minuto se registra en `voice_records.price` cuando Twilio lo
  devuelve en la consulta de estado.

## 9. Descargar el APK de Android

El APK de produccion se sirve como archivo estatico:

```
http://IP_DEL_SERVIDOR/static/sms-marketing-production.apk
```

En dispositivos Android, abra ese enlace en el navegador, descargue el APK e
instalelo (debe permitir "instalar de fuentes desconocidas"). El APK apunta por
defecto a la IP compilada; para que apunte a este servidor nuevo, reconstruya el
APK con `SMS_SERVER_URL=http://IP_DEL_SERVIDOR` (vease `mobile/`).

## 10. Actualizaciones futuras

```bash
cd /opt/sms-platform
git pull origin main

# Si cambiaron archivos de Python (app.py, requirements.txt):
docker compose up -d --build

# Si solo cambiaron archivos estaticos (CSS/JS/APK en static/), no hace falta
# reconstruir: Nginx los sirve directamente desde el host.
```

## 11. Comandos utiles

```bash
docker compose logs -f app               # Logs del backend
docker compose restart app               # Reiniciar backend
docker compose down                      # Detener (conserva datos)
docker volume ls                         # Ver volumenes (postgres-data)
```

## Estructura de datos

- PostgreSQL corre en un volumen Docker llamado `sms-platform_postgres-data`
  (o `<directorio>_postgres-data`).
- Backups:

```bash
docker compose exec db pg_dump -U sms_user sms_platform > backup_$(date +%F).sql
```
